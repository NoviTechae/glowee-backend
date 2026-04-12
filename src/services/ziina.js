// src/services/ziina.js
const axios = require('axios');
const db = require('../db/knex');
const crypto = require('crypto');

const ZIINA_API_URL = 'https://api-v2.ziina.com/api';
const ZIINA_API_KEY = (process.env.ZIINA_API_KEY || '').trim();

if (!ZIINA_API_KEY) {
  console.warn('ZIINA_API_KEY is not set');
}

console.log(
  'ZIINA KEY SHA256:',
  crypto.createHash('sha256').update(ZIINA_API_KEY).digest('hex')
);
console.log('ZIINA KEY EXISTS:', !!ZIINA_API_KEY);
console.log('ZIINA KEY PREFIX:', ZIINA_API_KEY.slice(0, 12));
console.log('ZIINA KEY SUFFIX:', ZIINA_API_KEY.slice(-8));
console.log('ZIINA KEY LENGTH:', ZIINA_API_KEY.length);
console.log('ZIINA API URL:', ZIINA_API_URL);

const ziinaClient = axios.create({
  baseURL: ZIINA_API_URL,
  headers: {
    Authorization: `Bearer ${ZIINA_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

function buildWalletUrls() {
  return {
    success_url: `${process.env.APP_URL}/wallet/payment/success`,
    cancel_url: `${process.env.APP_URL}/wallet/payment/cancel`,
  };
}

function buildBookingUrls() {
  return {
    success_url: `${process.env.API_URL}/payments/ziina/booking/success`,
    cancel_url: `${process.env.API_URL}/payments/ziina/booking/cancel`,
  };
}

function buildGiftUrls() {
  return {
    success_url: `${process.env.APP_URL}/gift/payment/success`,
    cancel_url: `${process.env.APP_URL}/gift/payment/cancel`,
  };
}

/**
 * Create payment intent for wallet topup
 */
async function createWalletTopupPaymentIntent(
  userId,
  amountAed,
  userPhone,
  userName,
  userEmail
) {
  try {
    const payload = {
      amount: Math.round(amountAed * 100),
      currency_code: 'AED',
      message: 'Glowee Test',
      ...buildWalletUrls(),
test: false,
    };

    console.log('Creating Ziina wallet payment intent...', {
      keyPrefix: ZIINA_API_KEY.slice(0, 12),
      keySuffix: ZIINA_API_KEY.slice(-8),
      amountAed,
    });
    console.log('ZIINA PAYLOAD:', payload);

    const response = await ziinaClient.post('/payment_intent', payload);
    const paymentIntent = response.data;

    if (!paymentIntent?.id || !paymentIntent?.redirect_url) {
      return {
        ok: false,
        error: 'Ziina did not return a valid payment intent',
      };
    }

    const [transaction] = await db('payment_transactions')
      .insert({
        user_id: userId,
        provider: 'ziina',
        type: 'wallet_topup',
        status: 'pending',
        amount_aed: amountAed,
        fee_aed: 0,
        net_amount_aed: amountAed,
        provider_payment_id: paymentIntent.id,
        metadata: {
          phone: userPhone || null,
          email: userEmail || null,
          name: userName || null,
          payment_url: paymentIntent.redirect_url,
          ziina_status: paymentIntent.status || 'pending',
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*');

    return {
      ok: true,
      payment_intent_id: paymentIntent.id,
      transaction_id: transaction.id,
      payment_url: paymentIntent.redirect_url,
      amount: amountAed,
      status: paymentIntent.status || 'pending',
    };
  } catch (error) {
    console.error('Ziina create wallet payment intent error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

/**
 * Create payment intent for booking payment
 */
async function createBookingPaymentIntent(
  userId,
  bookingId,
  amountAed,
  userPhone,
  userName,
  userEmail
) {
  try {
    const payload = {
      amount: Math.round(amountAed * 100),
      currency_code: 'AED',
      message: `Glowee · Beauty Booking`,
      ...buildBookingUrls(),
test: false,
    };

    console.log('Creating Ziina booking payment intent...', {
      bookingId,
      amountAed,
    });
    console.log('ZIINA BOOKING PAYLOAD:', payload);

    const response = await ziinaClient.post('/payment_intent', payload);
    const pi = response.data;

    if (!pi?.id || !pi?.redirect_url) {
      return {
        ok: false,
        error: 'Ziina did not return a valid booking payment intent',
      };
    }

    const [transaction] = await db('payment_transactions')
      .insert({
        user_id: userId,
        booking_id: bookingId,
        provider: 'ziina',
        type: 'booking_payment',
        status: 'pending',
        amount_aed: amountAed,
        fee_aed: 0,
        net_amount_aed: amountAed,
        provider_payment_id: pi.id,
        metadata: {
          phone: userPhone || null,
          email: userEmail || null,
          name: userName || null,
          payment_url: pi.redirect_url,
          ziina_status: pi.status || 'pending',
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*');

    return {
      ok: true,
      payment_url: pi.redirect_url,
      payment_intent_id: pi.id,
      transaction_id: transaction.id,
      amount: amountAed,
      status: pi.status || 'pending',
    };
  } catch (error) {
    console.error('Ziina create booking payment intent error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

/**
 * Create payment intent for gift payment
 */
async function createGiftPaymentIntent(
  userId,
  amountAed,
  recipientPhone,
  userPhone,
  userName,
  userEmail,
  metadata = {}
) {
  try {
    const payload = {
      amount: Math.round(amountAed * 100),
      currency_code: 'AED',
      message: 'Glowee Gift Payment',
      ...buildGiftUrls(),
test: false,
    };

    console.log('Creating Ziina gift payment intent...', {
      amountAed,
      recipientPhone,
    });
    console.log('ZIINA GIFT PAYLOAD:', payload);

    const response = await ziinaClient.post('/payment_intent', payload);
    const pi = response.data;

    if (!pi?.id || !pi?.redirect_url) {
      return {
        ok: false,
        error: 'Ziina did not return a valid gift payment intent',
      };
    }

    const [transaction] = await db('payment_transactions')
      .insert({
        user_id: userId,
        provider: 'ziina',
        type: 'gift_purchase',
        status: 'pending',
        amount_aed: amountAed,
        fee_aed: 0,
        net_amount_aed: amountAed,
        provider_payment_id: pi.id,
        gift_id: metadata.gift_id || null,
        metadata: {
          phone: userPhone || null,
          email: userEmail || null,
          name: userName || null,
          recipient_phone: recipientPhone || null,
          payment_url: pi.redirect_url,
          ziina_status: pi.status || 'pending',
          ...metadata,
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*');

    return {
      ok: true,
      payment_url: pi.redirect_url,
      payment_intent_id: pi.id,
      transaction_id: transaction.id,
      amount: amountAed,
      status: pi.status || 'pending',
    };
  } catch (error) {
    console.error('Ziina create gift payment intent error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.status,
    };
  }
}

/**
 * Fetch payment intent status from Ziina
 */
async function getPaymentIntentStatus(paymentIntentId) {
  try {
    const response = await ziinaClient.get(`/payment_intent/${paymentIntentId}`);
    const paymentIntent = response.data;

    return {
      ok: true,
      status: paymentIntent.status,
      amount: paymentIntent.amount ? paymentIntent.amount / 100 : null,
      raw: paymentIntent,
    };
  } catch (error) {
    console.error('Ziina get payment intent status error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Mark successful Ziina payment and apply business logic
 */
async function handlePaymentIntentSuccess(paymentIntentId, paymentIntentData = {}) {
  const trx = await db.transaction();

  try {
    const transaction = await trx('payment_transactions')
      .where({
        provider_payment_id: paymentIntentId,
        provider: 'ziina',
      })
      .first();

    if (!transaction) {
      await trx.rollback();
      return {
        ok: false,
        error: 'Transaction not found',
      };
    }

    if (transaction.status === 'succeeded') {
      await trx.commit();
      return {
        ok: true,
        already_processed: true,
      };
    }

    let paymentMethodType = 'card';
    let cardLast4 = null;
    let cardBrand = null;

    const source = paymentIntentData?.payment_method || paymentIntentData?.source || null;

    if (source) {
      cardLast4 = source.last4 || source.last_four || null;
      cardBrand = source.brand || source.scheme || null;

      if (String(cardBrand || '').toLowerCase().includes('apple')) {
        paymentMethodType = 'apple_pay';
      }
    }

    await trx('payment_transactions')
      .where({ id: transaction.id })
      .update({
        status: 'succeeded',
        succeeded_at: trx.fn.now(),
        payment_method_type: paymentMethodType,
        card_last4: cardLast4,
        card_brand: cardBrand,
        metadata: {
          ...(typeof transaction.metadata === 'object' && transaction.metadata !== null
            ? transaction.metadata
            : {}),
          ziina_status: paymentIntentData?.status || 'succeeded',
          ziina_payment_intent: paymentIntentData,
        },
        updated_at: trx.fn.now(),
      });

    if (transaction.type === 'wallet_topup') {
      const { addWalletBalance } = require('../controllers/walletController');

      await addWalletBalance(
        transaction.user_id,
        Number(transaction.net_amount_aed),
        `Wallet topup via Ziina${cardBrand ? ` (${cardBrand})` : ''}`,
        transaction.id,
        'topup',
        trx
      );

      if (Number(transaction.net_amount_aed) >= 100) {
        const { addPoints } = require('../controllers/rewardController');
        await addPoints(transaction.user_id, 20, 'wallet_topup', transaction.id, trx);
      }
    }

    if (transaction.type === 'booking_payment' && transaction.booking_id) {
      await trx('bookings')
        .where({ id: transaction.booking_id })
        .update({
          status: 'confirmed',
          updated_at: trx.fn.now(),
        });
    }

    await trx.commit();

    return {
      ok: true,
      transaction_id: transaction.id,
      amount: Number(transaction.amount_aed),
    };
  } catch (error) {
    await trx.rollback();
    console.error('Ziina handle payment success error:', error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

module.exports = {
  createWalletTopupPaymentIntent,
  createBookingPaymentIntent,
  createGiftPaymentIntent,
  getPaymentIntentStatus,
  handlePaymentIntentSuccess,
};  // src/routes/payments.js

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

router.get('/ziina/booking/success', async (req, res) => {
  try {
    const paymentIntentId =
      req.query.payment_intent_id ||
      req.query.id ||
      req.query.payment_intent ||
      null;

    console.log('Ziina booking success query:', req.query);

    if (!paymentIntentId) {
      return res.status(400).send('Missing payment_intent_id');
    }

    const result = await ziinaService.getPaymentIntentStatus(paymentIntentId);

    console.log('Ziina booking success status:', {
      paymentIntentId,
      status: result.status,
      raw: result.raw,
    });

    if (!result.ok) {
      console.error('Ziina booking success verify failed:', result.error);
      return res.status(400).send('Unable to verify payment');
    }

    const normalizedStatus = String(result.status || '').toLowerCase();

    // خليه أوسع شوي مؤقتًا عشان نلقط status الحقيقي
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

      console.log('Ziina handlePaymentIntentSuccess result:', successResult);

      if (!successResult.ok && !successResult.already_processed) {
        console.error('Ziina booking success handler failed:', successResult.error);
        return res.status(500).send('Failed to update booking');
      }
    } else {
      console.warn('Ziina payment returned non-success status:', normalizedStatus);
    }

    // بدل redirect لمسار يجيب 404، رجعي HTML نجاح بسيط
    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Payment Successful</title>
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
            <p>Your booking has been processed. You can return to Glowee.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Ziina booking success redirect error:', error);
    return res.status(500).send('Server error');
  }
});

router.get('/ziina/booking/cancel', async (req, res) => {
  try {
    console.log('Ziina booking cancel query:', req.query);
    return res.redirect(`${process.env.APP_URL}/booking/payment/cancel`);
  } catch (error) {
    console.error('Ziina booking cancel redirect error:', error);
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


module.exports = router;  // src/controllers/giftPaymentController.js

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