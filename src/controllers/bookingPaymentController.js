// src/controllers/bookingPaymentController.js

const db = require('../db/knex');
const tapService = require('../services/tap');
const { spendWalletBalance, addWalletBalance } = require('./walletController');

/**
 * Calculate payment split between wallet and card
 */
async function calculatePaymentSplit(userId, totalAmount) {
  const wallet = await db('wallets').where({ user_id: userId }).first();
  const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

  if (walletBalance >= totalAmount) {
    // Enough in wallet - no card needed
    return {
      wallet_amount: totalAmount,
      card_amount: 0,
      requires_card: false,
    };
  } else if (walletBalance > 0) {
    // Partial wallet, rest via card
    return {
      wallet_amount: walletBalance,
      card_amount: totalAmount - walletBalance,
      requires_card: true,
    };
  } else {
    // No wallet balance - all via card
    return {
      wallet_amount: 0,
      card_amount: totalAmount,
      requires_card: true,
    };
  }
}

/**
 * POST /bookings/:id/pay
 * Pay for a booking
 * 
 * Body:
 * {
 *   "payment_method": "wallet" | "card" | "split",
 *   "use_wallet": true/false (for split payment)
 * }
 */
const payForBooking = async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const { id: bookingId } = req.params;
    const { payment_method, use_wallet } = req.body;
    const userId = req.user.sub;

    // Get booking
    const booking = await trx('bookings')
      .where({ id: bookingId, user_id: userId })
      .first();

    if (!booking) {
      await trx.rollback();
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.status !== 'pending') {
      await trx.rollback();
      return res.status(400).json({ error: 'Booking already processed' });
    }

    const totalAmount = Number(booking.total_aed);

    // Get user details
    const user = await trx('users').where({ id: userId }).first();

    // OPTION 1: WALLET ONLY
    if (payment_method === 'wallet') {
      const wallet = await trx('wallets').where({ user_id: userId }).first();
      const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

      if (walletBalance < totalAmount) {
        await trx.rollback();
        return res.status(400).json({
          error: 'Insufficient wallet balance',
          wallet_balance: walletBalance,
          required: totalAmount,
          shortfall: totalAmount - walletBalance,
        });
      }

      // Deduct from wallet
      await spendWalletBalance(
        userId,
        totalAmount,
        `Booking payment #${bookingId}`,
        bookingId,
        'spent',
        trx
      );

      // Update booking
      await trx('bookings')
        .where({ id: bookingId })
        .update({
          status: 'confirmed',
          updated_at: trx.fn.now(),
        });

      // Record payment
      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet',
        type: 'booking_payment',
        status: 'succeeded',
        amount_aed: totalAmount,
        net_amount_aed: totalAmount,
        booking_id: bookingId,
        payment_method_type: 'wallet',
        succeeded_at: trx.fn.now(),
        created_at: trx.fn.now(),
      });

      await trx.commit();

      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: 'wallet',
        amount_paid: totalAmount,
        status: 'confirmed',
      });
    }

    // OPTION 2: CARD ONLY
    if (payment_method === 'card') {
      await trx.commit(); // Release transaction before Tap API call

      const tapResult = await tapService.createBookingCharge(
        userId,
        bookingId,
        totalAmount,
        user.phone,
        user.name,
        user.email
      );

      if (!tapResult.ok) {
        return res.status(400).json({
          error: tapResult.error,
          code: tapResult.code,
        });
      }

      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: 'card',
        payment_url: tapResult.payment_url,
        charge_id: tapResult.charge_id,
        transaction_id: tapResult.transaction_id,
        amount: totalAmount,
      });
    }

    // OPTION 3: SPLIT PAYMENT (Wallet + Card)
    if (payment_method === 'split' || use_wallet === true) {
      const split = await calculatePaymentSplit(userId, totalAmount);

      if (split.wallet_amount === 0) {
        await trx.rollback();
        return res.status(400).json({
          error: 'No wallet balance to use for split payment',
          suggestion: 'Use card payment instead',
        });
      }

      // Deduct wallet portion
      await spendWalletBalance(
        userId,
        split.wallet_amount,
        `Partial booking payment #${bookingId}`,
        bookingId,
        'spent',
        trx
      );

      // Record wallet payment
      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet',
        type: 'booking_payment',
        status: 'succeeded',
        amount_aed: split.wallet_amount,
        net_amount_aed: split.wallet_amount,
        booking_id: bookingId,
        payment_method_type: 'wallet',
        succeeded_at: trx.fn.now(),
        metadata: { split_payment: true, wallet_portion: true },
        created_at: trx.fn.now(),
      });

      await trx.commit();

      // Create Tap charge for remaining amount
      const tapResult = await tapService.createBookingCharge(
        userId,
        bookingId,
        split.card_amount,
        user.phone,
        user.name,
        user.email,
        { split_payment: true, wallet_used: split.wallet_amount }
      );

      if (!tapResult.ok) {
        // Rollback wallet deduction
        const refundTrx = await db.transaction();
        await addWalletBalance(
          userId,
          split.wallet_amount,
          `Refund - Split payment failed`,
          bookingId,
          'refund',
          refundTrx
        );
        await refundTrx.commit();

        return res.status(400).json({
          error: tapResult.error,
          wallet_refunded: true,
        });
      }

      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: 'split',
        wallet_amount: split.wallet_amount,
        card_amount: split.card_amount,
        payment_url: tapResult.payment_url,
        charge_id: tapResult.charge_id,
        transaction_id: tapResult.transaction_id,
      });
    }

    await trx.rollback();
    return res.status(400).json({
      error: 'Invalid payment method',
      valid_methods: ['wallet', 'card', 'split'],
    });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

/**
 * GET /bookings/:id/payment-options
 * Get available payment options for a booking
 */
const getPaymentOptions = async (req, res, next) => {
  try {
    const { id: bookingId } = req.params;
    const userId = req.user.sub;

    const booking = await db('bookings')
      .where({ id: bookingId, user_id: userId })
      .first();

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const totalAmount = Number(booking.total_aed);
    const split = await calculatePaymentSplit(userId, totalAmount);

    const options = {
      total_amount: totalAmount,
      wallet_balance: split.wallet_amount,
      payment_methods: [],
    };

    // Option 1: Full wallet payment
    if (split.wallet_amount >= totalAmount) {
      options.payment_methods.push({
        method: 'wallet',
        label: 'Pay from Wallet',
        amount: totalAmount,
        available: true,
      });
    }

    // Option 2: Card payment
    options.payment_methods.push({
      method: 'card',
      label: 'Pay with Card/Apple Pay',
      amount: totalAmount,
      available: true,
      providers: ['visa', 'mastercard', 'mada', 'apple_pay', 'google_pay'],
    });

    // Option 3: Split payment
    if (split.wallet_amount > 0 && split.wallet_amount < totalAmount) {
      options.payment_methods.push({
        method: 'split',
        label: 'Wallet + Card',
        wallet_amount: split.wallet_amount,
        card_amount: split.card_amount,
        available: true,
        description: `Pay AED ${split.wallet_amount} from wallet + AED ${split.card_amount} with card`,
      });
    }

    // If insufficient wallet, suggest topup
    if (split.wallet_amount < totalAmount) {
      options.suggestions = {
        topup_needed: totalAmount - split.wallet_amount,
        message: `Topup AED ${(totalAmount - split.wallet_amount).toFixed(2)} to pay fully from wallet`,
      };
    }

    return res.json({
      ok: true,
      ...options,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  payForBooking,
  getPaymentOptions,
  calculatePaymentSplit,
};