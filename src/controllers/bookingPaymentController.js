// src/controllers/bookingPaymentController.js

const db = require('../db/knex');
const ziinaService = require('../services/ziina');
const { spendWalletBalance, addWalletBalance } = require('./walletController');

/**
 * Calculate payment split between wallet and card
 */
async function calculatePaymentSplit(userId, totalAmount) {
  const wallet = await db('wallets').where({ user_id: userId }).first();
  const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

  if (walletBalance >= totalAmount) {
    return {
      wallet_amount: totalAmount,
      card_amount: 0,
      requires_card: false,
    };
  } else if (walletBalance > 0) {
    return {
      wallet_amount: walletBalance,
      card_amount: totalAmount - walletBalance,
      requires_card: true,
    };
  } else {
    return {
      wallet_amount: 0,
      card_amount: totalAmount,
      requires_card: true,
    };
  }
}

/**
 * Get stamp reward availability for this user + salon
 */
async function getStampRewardForSalon(userId, salonId, trx = db) {
  const card = await trx('user_salon_stamp_cards as c')
    .leftJoin('salon_stamp_settings as s', function () {
      this.on('s.salon_id', 'c.salon_id').andOn('s.is_active', '=', trx.raw('true'));
    })
    .where('c.user_id', userId)
    .andWhere('c.salon_id', salonId)
    .select([
      'c.user_id',
      'c.salon_id',
      'c.available_rewards',
      's.reward_text',
    ])
    .first();

  const availableRewards = Number(card?.available_rewards || 0);

  return {
    available: availableRewards > 0,
    available_rewards: availableRewards,
    reward_text: card?.reward_text || 'Free Service',
  };
}

/**
 * Consume 1 stamp reward for booking
 */
async function consumeStampRewardForBooking({ userId, salonId, bookingId, trx }) {
  const card = await trx('user_salon_stamp_cards')
    .where({
      user_id: userId,
      salon_id: salonId,
    })
    .forUpdate()
    .first();

  if (!card || Number(card.available_rewards || 0) <= 0) {
    throw new Error('No available stamp reward');
  }

  const nextRewards = Number(card.available_rewards || 0) - 1;

  await trx('user_salon_stamp_cards')
    .where({
      user_id: userId,
      salon_id: salonId,
    })
    .update({
      available_rewards: nextRewards,
      updated_at: trx.fn.now(),
    });

  await trx('salon_stamp_events').insert({
    user_id: userId,
    salon_id: salonId,
    booking_id: bookingId,
    type: 'reward_used',
    value: 1,
    created_at: trx.fn.now(),
  });

  return {
    ok: true,
    available_rewards: nextRewards,
  };
}

/**
 * POST /bookings/:id/pay
 *
 * Body:
 * {
 *   "payment_method": "wallet" | "card" | "split",
 *   "use_wallet": true/false,
 *   "use_stamp_reward": true/false
 * }
 */
const payForBooking = async (req, res, next) => {
  const trx = await db.transaction();

  try {
    const { id: bookingId } = req.params;
    const { payment_method, use_wallet, use_stamp_reward } = req.body;
    const userId = req.user.sub;

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
    const user = await trx('users').where({ id: userId }).first();

    if (!user) {
      await trx.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    // OPTION 0: STAMP REWARD
    if (use_stamp_reward === true) {
      const stampReward = await getStampRewardForSalon(userId, booking.salon_id, trx);

      if (!stampReward.available) {
        await trx.rollback();
        return res.status(400).json({
          error: 'No available stamp reward',
        });
      }

      await consumeStampRewardForBooking({
        userId,
        salonId: booking.salon_id,
        bookingId,
        trx,
      });

      await trx('bookings')
        .where({ id: bookingId })
        .update({
          status: 'confirmed',
          updated_at: trx.fn.now(),
        });

      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet', // نخليه wallet مؤقتًا لأن enum عندك ما يدعم stamp_reward
        type: 'booking_payment',
        status: 'succeeded',
        amount_aed: 0,
        fee_aed: 0,
        net_amount_aed: 0,
        booking_id: bookingId,
        payment_method_type: 'stamp_reward',
        succeeded_at: trx.fn.now(),
        metadata: {
          stamp_reward: true,
          reward_text: stampReward.reward_text,
        },
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      await trx.commit();

      return res.json({
        ok: true,
        used_stamp_reward: true,
        booking_id: bookingId,
        status: 'confirmed',
      });
    }

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

      await spendWalletBalance(
        userId,
        totalAmount,
        `Booking payment #${bookingId}`,
        bookingId,
        'spent',
        trx
      );

      await trx('bookings')
        .where({ id: bookingId })
        .update({
          status: 'confirmed',
          updated_at: trx.fn.now(),
        });

      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet',
        type: 'booking_payment',
        status: 'succeeded',
        amount_aed: totalAmount,
        fee_aed: 0,
        net_amount_aed: totalAmount,
        booking_id: bookingId,
        payment_method_type: 'wallet',
        succeeded_at: trx.fn.now(),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
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

    // OPTION 2: CARD ONLY via Ziina
    if (payment_method === 'card') {
      await trx.commit(); // release DB transaction before API call

      const ziinaResult = await ziinaService.createBookingPaymentIntent(
        userId,
        bookingId,
        totalAmount,
        user.phone,
        user.name,
        user.email
      );

      if (!ziinaResult.ok) {
        return res.status(400).json({
          error: ziinaResult.error,
          code: ziinaResult.code,
        });
      }

      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: 'card',
        provider: 'ziina',
        payment_url: ziinaResult.payment_url,
        payment_intent_id: ziinaResult.payment_intent_id,
        transaction_id: ziinaResult.transaction_id,
        amount: totalAmount,
      });
    }

    // OPTION 3: SPLIT PAYMENT (Wallet + Ziina)
    if (payment_method === 'split' || use_wallet === true) {
      const split = await calculatePaymentSplit(userId, totalAmount);

      if (split.wallet_amount === 0) {
        await trx.rollback();
        return res.status(400).json({
          error: 'No wallet balance to use for split payment',
          suggestion: 'Use card payment instead',
        });
      }

      await spendWalletBalance(
        userId,
        split.wallet_amount,
        `Partial booking payment #${bookingId}`,
        bookingId,
        'spent',
        trx
      );

      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet',
        type: 'booking_payment',
        status: 'succeeded',
        amount_aed: split.wallet_amount,
        fee_aed: 0,
        net_amount_aed: split.wallet_amount,
        booking_id: bookingId,
        payment_method_type: 'wallet',
        succeeded_at: trx.fn.now(),
        metadata: { split_payment: true, wallet_portion: true },
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      await trx.commit();

      const ziinaResult = await ziinaService.createBookingPaymentIntent(
        userId,
        bookingId,
        split.card_amount,
        user.phone,
        user.name,
        user.email,
        {
          split_payment: true,
          wallet_amount: split.wallet_amount,
          card_amount: split.card_amount,
        }
      );

      if (!ziinaResult.ok) {
        // refund wallet portion if Ziina payment intent creation fails
        const refundTrx = await db.transaction();
        try {
          await addWalletBalance(
            userId,
            split.wallet_amount,
            'Refund - Split payment failed',
            bookingId,
            'refund',
            refundTrx
          );
          await refundTrx.commit();
        } catch (refundError) {
          await refundTrx.rollback();
          console.error('Split payment wallet refund failed:', refundError);
        }

        return res.status(400).json({
          error: ziinaResult.error,
          wallet_refunded: true,
        });
      }

      return res.json({
        ok: true,
        booking_id: bookingId,
        payment_method: 'split',
        provider: 'ziina',
        wallet_amount: split.wallet_amount,
        card_amount: split.card_amount,
        payment_url: ziinaResult.payment_url,
        payment_intent_id: ziinaResult.payment_intent_id,
        transaction_id: ziinaResult.transaction_id,
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
    const stampReward = await getStampRewardForSalon(userId, booking.salon_id);

    const options = {
      total_amount: totalAmount,
      wallet_balance: split.wallet_amount,
      payment_methods: [],
    };

    if (split.wallet_amount >= totalAmount) {
      options.payment_methods.push({
        method: 'wallet',
        label: 'Pay from Wallet',
        amount: totalAmount,
        available: true,
      });
    }

    options.payment_methods.push({
      method: 'card',
      label: 'Pay with Card/Apple Pay',
      amount: totalAmount,
      available: true,
      provider: 'ziina',
      providers: ['visa', 'mastercard', 'apple_pay', 'google_pay'],
    });

    if (split.wallet_amount > 0 && split.wallet_amount < totalAmount) {
      options.payment_methods.push({
        method: 'split',
        label: 'Wallet + Card',
        wallet_amount: split.wallet_amount,
        card_amount: split.card_amount,
        available: true,
        provider: 'ziina',
        description: `Pay AED ${split.wallet_amount} from wallet + AED ${split.card_amount} with card`,
      });
    }

    if (split.wallet_amount < totalAmount) {
      options.suggestions = {
        topup_needed: totalAmount - split.wallet_amount,
        message: `Topup AED ${(totalAmount - split.wallet_amount).toFixed(2)} to pay fully from wallet`,
      };
    }

    return res.json({
      ok: true,
      ...options,
      stamp_reward: {
        available: stampReward.available,
        available_rewards: stampReward.available_rewards,
        reward_text: stampReward.reward_text,
      },
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