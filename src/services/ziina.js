// src/services/ziina.js
const axios = require('axios');
const db = require('../db/knex');

const crypto = require('crypto');
const ZIINA_API_KEY = (process.env.ZIINA_API_KEY || '').trim();

console.log(
  'ZIINA KEY SHA256:',
  crypto.createHash('sha256').update(ZIINA_API_KEY).digest('hex')
);

const ZIINA_API_URL = 'https://api-v2.ziina.com/api';
//const ZIINA_API_KEY = (process.env.ZIINA_API_KEY || '').trim();

if (!ZIINA_API_KEY) {
  console.warn('ZIINA_API_KEY is not set');
}

console.log('ZIINA KEY EXISTS:', !!ZIINA_API_KEY);
console.log('ZIINA KEY PREFIX:', ZIINA_API_KEY.slice(0, 8));
console.log('ZIINA KEY LENGTH:', ZIINA_API_KEY.length);
console.log('ZIINA API URL:', ZIINA_API_URL);

const ziinaClient = axios.create({
  baseURL: ZIINA_API_URL,
  headers: {
    Authorization: `Bearer ${ZIINA_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Create payment intent for wallet topup
 */
async function createWalletTopupPaymentIntent(userId, amountAed, userPhone, userName, userEmail) {
  try {
    const key = (process.env.ZIINA_API_KEY || '').trim();

    console.log('Creating Ziina payment intent...', {
      keyPrefix: key.slice(0, 12),
      keySuffix: key.slice(-8),
      amountAed,
    });

    const payload = {
      amount: Math.round(amountAed * 100),
      currency_code: 'AED',
      message: 'Glowee Test',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      test: true,
    };

    console.log('ZIINA PAYLOAD:', payload);

    const response = await axios.post(
      'https://api-v2.ziina.com/api/payment_intent',
      payload,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const paymentIntent = response.data;

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
    console.error('Ziina create payment intent error full:', {
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
    console.error('Ziina get payment intent status error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Mark successful Ziina payment and credit wallet
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
      cardLast4 =
        source.last4 ||
        source.last_four ||
        null;

      cardBrand =
        source.brand ||
        source.scheme ||
        null;

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
        metadata: JSON.stringify({
          ...(typeof transaction.metadata === 'object' && transaction.metadata !== null
            ? transaction.metadata
            : {}),
          ziina_status: paymentIntentData?.status || 'succeeded',
          ziina_payment_intent: paymentIntentData,
        }),
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
  getPaymentIntentStatus,
  handlePaymentIntentSuccess,
};