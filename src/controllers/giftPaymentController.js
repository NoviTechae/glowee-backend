// src/controllers/giftPaymentController.js

const db = require('../db/knex');
const tapService = require('../services/tap');
const { spendWalletBalance, addWalletBalance } = require('./walletController');
const { addPoints } = require('./rewardController');

/**
 * POST /gifts/send-with-payment
 * Send gift with payment
 * 
 * Body:
 * {
 *   "recipient_phone": "+971501234567",
 *   "gift_type": "money" | "service",
 *   "amount_aed": 200,
 *   "service_items": [...], // Only for service gifts
 *   "payment_method": "card" | "wallet" | "split",
 *   "message": "Happy Birthday!",
 *   "sender_name": "Ali",
 *   "theme_id": "birthday"
 * }
 */
const sendGiftWithPayment = async (req, res, next) => {
  const trx = await db.transaction();
  
  try {
    const {
      recipient_phone,
      gift_type,
      amount_aed,
      service_items,
      payment_method,
      message,
      sender_name,
      theme_id,
      salon_id,
    } = req.body;

    const userId = req.user.sub;
    const user = await trx('users').where({ id: userId }).first();

    // Validate gift type
    if (!['money', 'service'].includes(gift_type)) {
      await trx.rollback();
      return res.status(400).json({
        error: 'Invalid gift type',
        valid_types: ['money', 'service'],
      });
    }

    // RULE 1: Money gifts can ONLY be paid by card
    if (gift_type === 'money' && payment_method !== 'card') {
      await trx.rollback();
      return res.status(400).json({
        error: 'Money gifts must be paid with card/Apple Pay',
        valid_methods: ['card'],
        reason: 'Money gifts cannot be paid from wallet',
      });
    }

    // RULE 2: Service gifts can be paid by wallet, card, or split
    if (gift_type === 'service' && !['wallet', 'card', 'split'].includes(payment_method)) {
      await trx.rollback();
      return res.status(400).json({
        error: 'Invalid payment method for service gift',
        valid_methods: ['wallet', 'card', 'split'],
      });
    }

    const totalAmount = Number(amount_aed);

    // Create gift code
    const { v4: uuidv4 } = require('uuid');
    const giftCode = uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 3 months

    // PAYMENT OPTION 1: WALLET ONLY (Service gifts only)
    if (payment_method === 'wallet') {
      if (gift_type === 'money') {
        await trx.rollback();
        return res.status(400).json({
          error: 'Cannot pay for money gifts with wallet',
        });
      }

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

      // Create gift
      const [gift] = await trx('gifts').insert({
        sender_user_id: userId,
        recipient_phone,
        salon_id: salon_id || null,
        amount_aed: totalAmount,
        code: giftCode,
        expires_at: expiresAt,
        message: message || null,
        theme_id: theme_id || null,
        sender_name: sender_name || user.name || null,
        status: 'active',
        created_at: trx.fn.now(),
      }).returning('*');

      // Store service items
      if (Array.isArray(service_items) && service_items.length > 0) {
        for (const item of service_items) {
          await trx('gift_items').insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name,
            qty: item.qty || 1,
            unit_price_aed: item.unit_price_aed,
            line_total_aed: item.unit_price_aed * (item.qty || 1),
            duration_mins: item.duration_mins || 0,
            created_at: trx.fn.now(),
          });
        }
      }

      // Deduct from wallet
      await spendWalletBalance(
        userId,
        totalAmount,
        `Gift sent to ${recipient_phone}`,
        gift.id,
        'gift_sent',
        trx
      );

      // Reward points for sending gift
      await addPoints(userId, 10, 'gift_sent', gift.id, trx);

      // Record payment
      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet',
        type: 'gift_purchase',
        status: 'succeeded',
        amount_aed: totalAmount,
        net_amount_aed: totalAmount,
        gift_id: gift.id,
        payment_method_type: 'wallet',
        succeeded_at: trx.fn.now(),
        created_at: trx.fn.now(),
      });

      await trx.commit();

      // Send WhatsApp notification
      const { sendGiftNotification } = require('../services/whatsapp');
      setImmediate(() => {
        sendGiftNotification(recipient_phone, {
          code: giftCode,
          senderName: sender_name || user.name || 'Someone',
          amount: totalAmount.toFixed(2),
          message,
          themeEmoji: theme_id === 'birthday' ? '🎂' : '🎁',
        });
      });

      return res.json({
        ok: true,
        gift_id: gift.id,
        code: giftCode,
        payment_method: 'wallet',
        amount_paid: totalAmount,
      });
    }

    // PAYMENT OPTION 2: CARD ONLY
    if (payment_method === 'card') {
      // Create gift first (pending payment)
      const [gift] = await trx('gifts').insert({
        sender_user_id: userId,
        recipient_phone,
        salon_id: salon_id || null,
        amount_aed: totalAmount,
        code: giftCode,
        expires_at: expiresAt,
        message: message || null,
        theme_id: theme_id || null,
        sender_name: sender_name || user.name || null,
        status: 'pending', // Will be activated after payment
        created_at: trx.fn.now(),
      }).returning('*');

      // Store service items if service gift
      if (gift_type === 'service' && Array.isArray(service_items)) {
        for (const item of service_items) {
          await trx('gift_items').insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name,
            qty: item.qty || 1,
            unit_price_aed: item.unit_price_aed,
            line_total_aed: item.unit_price_aed * (item.qty || 1),
            duration_mins: item.duration_mins || 0,
            created_at: trx.fn.now(),
          });
        }
      }

      await trx.commit();

      // Create Tap charge
      const tapResult = await tapService.createGiftCharge(
        userId,
        totalAmount,
        recipient_phone,
        user.phone,
        user.name,
        user.email,
        {
          gift_id: gift.id,
          gift_type,
          gift_code: giftCode,
        }
      );

      if (!tapResult.ok) {
        // Mark gift as cancelled
        await db('gifts').where({ id: gift.id }).update({ status: 'cancelled' });
        
        return res.status(400).json({
          error: tapResult.error,
          code: tapResult.code,
        });
      }

      return res.json({
        ok: true,
        gift_id: gift.id,
        payment_method: 'card',
        payment_url: tapResult.payment_url,
        charge_id: tapResult.charge_id,
        transaction_id: tapResult.transaction_id,
        amount: totalAmount,
      });
    }

    // PAYMENT OPTION 3: SPLIT (Wallet + Card) - Service gifts only
    if (payment_method === 'split') {
      if (gift_type === 'money') {
        await trx.rollback();
        return res.status(400).json({
          error: 'Cannot use split payment for money gifts',
          valid_methods: ['card'],
        });
      }

      const wallet = await trx('wallets').where({ user_id: userId }).first();
      const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

      if (walletBalance === 0) {
        await trx.rollback();
        return res.status(400).json({
          error: 'No wallet balance for split payment',
          suggestion: 'Use card payment instead',
        });
      }

      const walletAmount = Math.min(walletBalance, totalAmount);
      const cardAmount = totalAmount - walletAmount;

      // Create gift
      const [gift] = await trx('gifts').insert({
        sender_user_id: userId,
        recipient_phone,
        salon_id: salon_id || null,
        amount_aed: totalAmount,
        code: giftCode,
        expires_at: expiresAt,
        message: message || null,
        theme_id: theme_id || null,
        sender_name: sender_name || user.name || null,
        status: 'pending',
        created_at: trx.fn.now(),
      }).returning('*');

      // Store service items
      if (Array.isArray(service_items)) {
        for (const item of service_items) {
          await trx('gift_items').insert({
            gift_id: gift.id,
            service_availability_id: item.availability_id,
            service_name: item.service_name,
            qty: item.qty || 1,
            unit_price_aed: item.unit_price_aed,
            line_total_aed: item.unit_price_aed * (item.qty || 1),
            duration_mins: item.duration_mins || 0,
            created_at: trx.fn.now(),
          });
        }
      }

      // Deduct wallet portion
      await spendWalletBalance(
        userId,
        walletAmount,
        `Partial gift payment to ${recipient_phone}`,
        gift.id,
        'gift_sent',
        trx
      );

      // Record wallet payment
      await trx('payment_transactions').insert({
        user_id: userId,
        provider: 'wallet',
        type: 'gift_purchase',
        status: 'succeeded',
        amount_aed: walletAmount,
        net_amount_aed: walletAmount,
        gift_id: gift.id,
        payment_method_type: 'wallet',
        succeeded_at: trx.fn.now(),
        metadata: { split_payment: true },
        created_at: trx.fn.now(),
      });

      await trx.commit();

      // Create Tap charge for card portion
      const tapResult = await tapService.createGiftCharge(
        userId,
        cardAmount,
        recipient_phone,
        user.phone,
        user.name,
        user.email,
        {
          gift_id: gift.id,
          gift_type,
          split_payment: true,
          wallet_used: walletAmount,
        }
      );

      if (!tapResult.ok) {
        // Refund wallet
        const refundTrx = await db.transaction();
        await addWalletBalance(
          userId,
          walletAmount,
          'Refund - Split payment failed',
          gift.id,
          'refund',
          refundTrx
        );
        await db('gifts').where({ id: gift.id }).update({ status: 'cancelled' });
        await refundTrx.commit();

        return res.status(400).json({
          error: tapResult.error,
          wallet_refunded: true,
        });
      }

      return res.json({
        ok: true,
        gift_id: gift.id,
        payment_method: 'split',
        wallet_amount: walletAmount,
        card_amount: cardAmount,
        payment_url: tapResult.payment_url,
        charge_id: tapResult.charge_id,
        transaction_id: tapResult.transaction_id,
      });
    }

    await trx.rollback();
    return res.status(400).json({
      error: 'Invalid payment method',
    });
  } catch (error) {
    await trx.rollback();
    next(error);
  }
};

/**
 * GET /gifts/payment-options
 * Get available payment options for sending a gift
 */
const getGiftPaymentOptions = async (req, res, next) => {
  try {
    const { gift_type, amount_aed } = req.query;
    const userId = req.user.sub;

    if (!gift_type || !amount_aed) {
      return res.status(400).json({
        error: 'gift_type and amount_aed required',
      });
    }

    const totalAmount = Number(amount_aed);
    const wallet = await db('wallets').where({ user_id: userId }).first();
    const walletBalance = wallet ? Number(wallet.balance_aed) : 0;

    const options = {
      gift_type,
      total_amount: totalAmount,
      wallet_balance: walletBalance,
      payment_methods: [],
    };

    // MONEY GIFTS: Card only
    if (gift_type === 'money') {
      options.payment_methods.push({
        method: 'card',
        label: 'Pay with Card/Apple Pay',
        amount: totalAmount,
        available: true,
        providers: ['visa', 'mastercard', 'mada', 'apple_pay', 'google_pay'],
        required: true,
        note: 'Money gifts must be paid with card',
      });
    }

    // SERVICE GIFTS: Wallet, Card, or Split
    if (gift_type === 'service') {
      // Full wallet
      if (walletBalance >= totalAmount) {
        options.payment_methods.push({
          method: 'wallet',
          label: 'Pay from Wallet',
          amount: totalAmount,
          available: true,
        });
      }

      // Card
      options.payment_methods.push({
        method: 'card',
        label: 'Pay with Card/Apple Pay',
        amount: totalAmount,
        available: true,
        providers: ['visa', 'mastercard', 'mada', 'apple_pay', 'google_pay'],
      });

      // Split
      if (walletBalance > 0 && walletBalance < totalAmount) {
        options.payment_methods.push({
          method: 'split',
          label: 'Wallet + Card',
          wallet_amount: walletBalance,
          card_amount: totalAmount - walletBalance,
          available: true,
          description: `Pay AED ${walletBalance} from wallet + AED ${(totalAmount - walletBalance).toFixed(2)} with card`,
        });
      }
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
  sendGiftWithPayment,
  getGiftPaymentOptions,
};