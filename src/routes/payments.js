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

    // عدلي أسماء statuses حسب Ziina الحقيقي
    const successStatuses = [
      'completed',
      'paid',
      'succeeded',
      'success',
      'successful',
      'captured',
      'processed',
      'requires_capture',
    ];

    if (successStatuses.includes(String(result.status).toLowerCase())) {
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

router.get('/ziina/booking/success', async (req, res) => {
  try {
    const paymentIntentId =
      req.query.payment_intent_id ||
      req.query.id ||
      req.query.payment_intent ||
      null;

    console.log('Ziina booking success query:', req.query);
    console.log('Ziina booking success paymentIntentId:', paymentIntentId);

    if (!paymentIntentId) {
      return res.status(400).send('Missing payment_intent_id');
    }

    const result = await ziinaService.getPaymentIntentStatus(paymentIntentId);

    console.log('Ziina booking success verify result:', result);

    if (!result.ok) {
      console.error('Ziina booking success verify failed:', result.error);
      return res.status(400).send('Unable to verify payment');
    }

    const normalizedStatus = String(result.status || '').toLowerCase();

    console.log('Ziina booking success normalized status:', normalizedStatus);

    const successStatuses = [
      'completed',
      'paid',
      'succeeded',
      'success',
      'successful',
      'captured',
      'processed',
      'requires_capture',
    ];

    let bookingId = '';

    if (successStatuses.includes(normalizedStatus)) {
      const successResult = await ziinaService.handlePaymentIntentSuccess(
        paymentIntentId,
        result.raw
      );

      console.log('Ziina booking success handler result:', successResult);

      if (!successResult.ok && !successResult.already_processed) {
        console.error('Ziina booking success handler failed:', successResult.error);
        return res.status(500).send('Failed to confirm booking');
      }

      bookingId = successResult.booking_id || '';
    } else {
      console.log('Ziina booking success skipped because status is not treated as success');
    }

    return res.redirect(
      `/payments/ziina/booking/done?booking_id=${encodeURIComponent(bookingId)}&payment_intent_id=${paymentIntentId}`
    );
  } catch (error) {
    console.error('Ziina booking success redirect error:', error);
    return res.status(500).send('Server error');
  }
});

router.get('/ziina/booking/cancel', async (req, res) => {
  try {
    console.log('Ziina booking cancel query:', req.query);

    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Booking Payment Cancelled</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f8f5f2;
              color: #111;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              text-align: center;
              padding: 24px;
            }
            .box {
              max-width: 420px;
              background: white;
              border-radius: 16px;
              padding: 24px;
              box-shadow: 0 8px 30px rgba(0,0,0,0.08);
            }
            h1 { margin: 0 0 12px; font-size: 28px; }
            p { margin: 0; color: #555; }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>Payment cancelled</h1>
            <p>Your booking payment was cancelled. You can return to Glowee and try again.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Ziina booking cancel redirect error:', error);
    return res.status(500).send('Server error');
  }
});

router.get('/ziina/booking/done', async (req, res) => {
  const bookingId = req.query.booking_id || '';

  return res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Payment Success</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f8f5f2;
            color: #111;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            text-align: center;
            padding: 24px;
          }
          .box {
            max-width: 420px;
            background: white;
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.08);
          }
          h1 { margin: 0 0 12px; font-size: 28px; }
          p { margin: 0 0 10px; color: #555; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>Payment successful</h1>
          <p>Your booking has been confirmed.</p>
          <p>Booking ID: ${bookingId || "-"}</p>
        </div>
      </body>
    </html>
  `);
});

router.get('/ziina/gift/success', async (req, res) => {
  try {
    const paymentIntentId =
      req.query.payment_intent_id ||
      req.query.id ||
      req.query.payment_intent ||
      null;

    console.log('Ziina gift success query:', req.query);

    if (!paymentIntentId) {
      return res.status(400).send('Missing payment_intent_id');
    }

    const result = await ziinaService.getPaymentIntentStatus(paymentIntentId);

    if (!result.ok) {
      console.error('Ziina gift success verify failed:', result.error);
      return res.status(400).send('Unable to verify payment');
    }

    const normalizedStatus = String(result.status || '').toLowerCase();

    const successStatuses = [
      'completed',
      'paid',
      'succeeded',
      'success',
      'successful',
      'captured',
      'processed',
      'requires_capture',
    ];

    if (successStatuses.includes(normalizedStatus)) {
      const successResult = await ziinaService.handlePaymentIntentSuccess(
        paymentIntentId,
        result.raw
      );

      if (!successResult.ok && !successResult.already_processed) {
        console.error('Ziina gift success handler failed:', successResult.error);
        return res.status(500).send('Failed to activate gift');
      }
    }

    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Gift Payment Successful</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f8f5f2;
              color: #111;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              text-align: center;
              padding: 24px;
            }
            .box {
              max-width: 420px;
              background: white;
              border-radius: 16px;
              padding: 24px;
              box-shadow: 0 8px 30px rgba(0,0,0,0.08);
            }
            h1 { margin: 0 0 12px; font-size: 28px; }
            p { margin: 0; color: #555; }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>Payment successful</h1>
            <p>Your gift has been activated. You can return to Glowee.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Ziina gift success redirect error:', error);
    return res.status(500).send('Server error');
  }
});

router.get('/ziina/gift/cancel', async (req, res) => {
  try {
    console.log('Ziina gift cancel query:', req.query);
    return res.send('Gift payment cancelled');
  } catch (error) {
    console.error('Ziina gift cancel redirect error:', error);
    return res.status(500).send('Server error');
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