// src/routes/payments.js

const router = require('express').Router();
const { z } = require('zod');
const authRequired = require('../middleware/authRequired');
const tapService = require('../services/tap');
const ziinaService = require('../services/ziina');
const db = require('../db/knex');

// ========================================
// WALLET TOPUP
// ========================================

/**
 * POST /payments/wallet/topup
 * Create Tap payment charge for wallet topup
 */
// const TapTopupSchema = z.object({
//   amount_aed: z.number().min(10).max(10000),
// });

const WalletTopupSchema = z.object({
  amount_aed: z.number().min(10).max(10000),
  provider: z.enum(['tap', 'ziina']).optional().default('ziina'),
});

// router.post('/wallet/topup', authRequired, async (req, res, next) => {
//   try {
//     const { amount_aed } = TapTopupSchema.parse(req.body);
//     const userId = req.user.sub;
    
//     // Get user details
//     const user = await db('users').where({ id: userId }).first();
    
//     const result = await tapService.createWalletTopupCharge(
//       userId,
//       amount_aed,
//       user.phone,
//       user.name,
//       user.email
//     );

//     if (!result.ok) {
//       return res.status(400).json({
//         error: result.error,
//         code: result.code,
//       });
//     }

//     return res.json({
//       ok: true,
//       charge_id: result.charge_id,
//       transaction_id: result.transaction_id,
//       payment_url: result.payment_url, // Redirect user here
//       amount: result.amount,
//       status: result.status,
//     });
//   } catch (error) {
//     next(error);
//   }
// });

// ========================================
// SAVED CARDS
// ========================================

router.post('/wallet/topup', authRequired, async (req, res, next) => {
  try {
    const { amount_aed, provider } = WalletTopupSchema.parse(req.body);
    const userId = req.user.sub;

    const user = await db('users').where({ id: userId }).first();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let result;

    console.log('WALLET TOPUP REQUEST:', {
  userId,
  amount_aed,
  provider,
});

    if (provider === 'ziina') {
      result = await ziinaService.createWalletTopupPaymentIntent(
        userId,
        amount_aed,
        user.phone,
        user.name,
        user.email
      );
    } else {
      result = await tapService.createWalletTopupCharge(
        userId,
        amount_aed,
        user.phone,
        user.name,
        user.email
      );
    }

    if (!result.ok) {
      return res.status(400).json({
        error: result.error,
        code: result.code,
      });
    }

    return res.json({
      ok: true,
      provider,
      charge_id: result.charge_id || null,
      payment_intent_id: result.payment_intent_id || null,
      transaction_id: result.transaction_id,
      payment_url: result.payment_url,
      amount: result.amount,
      status: result.status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payments/cards
 * List saved cards for user
 */
router.get('/cards', authRequired, async (req, res, next) => {
  try {
    const result = await tapService.listSavedCards(req.user.sub);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({
      ok: true,
      cards: result.cards,
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// PAYMENT STATUS
// ========================================

/**
 * GET /payments/transaction/:id
 * Get payment transaction status
 */
router.get('/transaction/:id', authRequired, async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await db('payment_transactions')
      .where({ id, user_id: req.user.sub })
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    return res.json({
      ok: true,
      transaction: {
        id: transaction.id,
        provider: transaction.provider,
        type: transaction.type,
        status: transaction.status,
        amount_aed: Number(transaction.amount_aed),
        created_at: transaction.created_at,
        succeeded_at: transaction.succeeded_at,
        failed_at: transaction.failed_at,
        payment_method: {
          type: transaction.payment_method_type,
          card_last4: transaction.card_last4,
          card_brand: transaction.card_brand,
        },
        error: transaction.error_message,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payments/history
 * Get user's payment history
 */
router.get('/history', authRequired, async (req, res, next) => {
  try {
    const limit = Math.min(50, Number(req.query.limit || 20));
    const offset = Number(req.query.offset || 0);

    const transactions = await db('payment_transactions')
      .where({ user_id: req.user.sub })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .select([
        'id',
        'provider',
        'type',
        'status',
        'amount_aed',
        'payment_method_type',
        'card_last4',
        'card_brand',
        'created_at',
        'succeeded_at',
      ]);

    const total = await db('payment_transactions')
      .where({ user_id: req.user.sub })
      .count('* as count')
      .first();

    return res.json({
      ok: true,
      data: transactions.map((t) => ({
        id: t.id,
        provider: t.provider,
        type: t.type,
        status: t.status,
        amount_aed: Number(t.amount_aed),
        payment_method: {
          type: t.payment_method_type,
          card_last4: t.card_last4,
          card_brand: t.card_brand,
        },
        created_at: t.created_at,
        succeeded_at: t.succeeded_at,
      })),
      pagination: {
        limit,
        offset,
        total: Number(total.count),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// WEBHOOKS (No auth required)
// ========================================

/**
 * POST /payments/webhooks/tap
 * Handle Tap payment webhooks
 */
router.post('/webhooks/tap', async (req, res) => {
  try {
    const { id, status, object } = req.body;

    console.log('Tap webhook received:', { id, status, object });

    // Tap webhook statuses:
    // INITIATED → AUTHORIZED → CAPTURED
    // or FAILED, CANCELLED

    if (!id || !status) {
      console.error('Invalid Tap webhook payload');
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // Handle different statuses
    if (status === 'CAPTURED' || status === 'AUTHORIZED') {
      const result = await tapService.handlePaymentSuccess(id, req.body);

      if (!result.ok && !result.already_processed) {
        console.error('Tap webhook handler error:', result.error);
        return res.status(500).json({ error: result.error });
      }
    } else if (status === 'FAILED' || status === 'CANCELLED' || status === 'DECLINED') {
      const errorMsg = req.body.response?.message || 'Payment failed';
      const errorCode = req.body.response?.code || 'unknown';

      await tapService.handlePaymentFailed(id, errorMsg, errorCode);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Tap webhook handling error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

router.get('/verify/ziina/:paymentIntentId', authRequired, async (req, res, next) => {
  try {
    const { paymentIntentId } = req.params;

    const transaction = await db('payment_transactions')
      .where({
        provider_payment_id: paymentIntentId,
        provider: 'ziina',
        user_id: req.user.sub,
      })
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status === 'succeeded') {
      return res.json({
        ok: true,
        status: 'succeeded',
        amount: Number(transaction.amount_aed),
      });
    }

    const result = await ziinaService.getPaymentIntentStatus(paymentIntentId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    if (['completed', 'paid', 'succeeded', 'requires_capture'].includes(String(result.status).toLowerCase())) {
      const successResult = await ziinaService.handlePaymentIntentSuccess(paymentIntentId, result.raw);

      if (!successResult.ok && !successResult.already_processed) {
        return res.status(500).json({ error: successResult.error });
      }

      return res.json({
        ok: true,
        status: 'succeeded',
        amount: Number(transaction.amount_aed),
      });
    }

    return res.json({
      ok: true,
      status: result.status,
      amount: result.amount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payments/verify/:chargeId
 * Verify payment status (for frontend polling)
 */
router.get('/verify/:chargeId', authRequired, async (req, res, next) => {
  try {
    const { chargeId } = req.params;

    // Find transaction
    const transaction = await db('payment_transactions')
      .where({ provider_payment_id: chargeId, user_id: req.user.sub })
      .first();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // If already succeeded, return
    if (transaction.status === 'succeeded') {
      return res.json({
        ok: true,
        status: 'succeeded',
        amount: Number(transaction.amount_aed),
      });
    }

    // Check with Tap API
    const result = await tapService.getChargeStatus(chargeId);

    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({
      ok: true,
      status: result.status,
      amount: result.amount,
      card: result.card,
    });
  } catch (error) {
    next(error);
  }
});

const bookingPayment = require('../controllers/bookingPaymentController');
const giftPayment = require('../controllers/giftPaymentController');

// Booking payments
router.get('/bookings/:id/payment-options', authRequired, bookingPayment.getPaymentOptions);
router.post('/bookings/:id/pay', authRequired, bookingPayment.payForBooking);

// Gift payments
router.get('/gifts/payment-options', authRequired, giftPayment.getGiftPaymentOptions);
router.post('/gifts/send-with-payment', authRequired, giftPayment.sendGiftWithPayment);


module.exports = router;