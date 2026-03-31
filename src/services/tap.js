// src/services/tap.js

/**
 * Tap Payments Service (UAE/Middle East focused)
 * 
 * Why Tap over Stripe for UAE:
 * - Lower fees (2.5% vs 2.9%)
 * - Local company (Dubai-based)
 * - Better MADA card support
 * - Faster payouts in AED
 * - Arabic language support
 * - Optimized for Middle East
 * 
 * Setup:
 * 1. Create account: https://www.tap.company/
 * 2. Get API keys from dashboard
 * 3. Add to .env:
 *    TAP_SECRET_KEY=sk_live_...
 *    TAP_PUBLISHABLE_KEY=pk_live_...
 */

const axios = require('axios');
const db = require('../db/knex');

const TAP_API_URL = 'https://api.tap.company/v2';
const TAP_SECRET_KEY = process.env.TAP_SECRET_KEY;

const tapClient = axios.create({
  baseURL: TAP_API_URL,
  headers: {
    'Authorization': `Bearer ${TAP_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Create Tap customer for user
 */
async function createTapCustomer(userId, userPhone, userEmail, userName) {
  try {
    const response = await tapClient.post('/customers', {
      first_name: userName?.split(' ')[0] || 'User',
      last_name: userName?.split(' ').slice(1).join(' ') || '',
      email: userEmail || `user${userId}@glowee.app`,
      phone: {
        country_code: '971',
        number: userPhone.replace('+971', '').replace(/\s/g, ''),
      },
      metadata: {
        glowee_user_id: userId.toString(),
      },
    });

    return {
      ok: true,
      customer_id: response.data.id,
    };
  } catch (error) {
    console.error('Tap create customer error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Create payment charge for wallet topup
 */
async function createWalletTopupCharge(userId, amountAed, userPhone, userName, userEmail) {
  try {
    const user = await db('users').where({ id: userId }).first();
    
    // Get or create Tap customer
    let customerId = null;
    const existingPayment = await db('payment_transactions')
      .where({ user_id: userId, provider: 'tap' })
      .whereNotNull('provider_customer_id')
      .first();

    if (existingPayment?.provider_customer_id) {
      customerId = existingPayment.provider_customer_id;
    } else {
      const customerResult = await createTapCustomer(
        userId,
        userPhone,
        userEmail,
        userName
      );
      if (customerResult.ok) {
        customerId = customerResult.customer_id;
      }
    }

    // Create charge
    const response = await tapClient.post('/charges', {
      amount: amountAed,
      currency: 'AED',
      customer_initiated: true,
      threeDSecure: true, // Enable 3D Secure
      save_card: false,
      description: `Glowee Wallet Topup - AED ${amountAed}`,
      metadata: {
        glowee_user_id: userId.toString(),
        type: 'wallet_topup',
        udf1: 'wallet_topup', // Custom field
      },
      receipt: {
        email: true,
        sms: true,
      },
      customer: customerId ? { id: customerId } : {
        first_name: userName?.split(' ')[0] || 'User',
        email: userEmail || `user${userId}@glowee.app`,
        phone: {
          country_code: '971',
          number: userPhone.replace('+971', '').replace(/\s/g, ''),
        },
      },
      source: {
        id: 'src_all', // Accept all payment methods
      },
      post: {
        url: `${process.env.API_URL}/payments/webhooks/tap`, // Webhook URL
      },
      redirect: {
        url: `${process.env.APP_URL}/wallet/payment/success`, // Success redirect
      },
    });

    const charge = response.data;

    // Create payment transaction record
    const [transaction] = await db('payment_transactions')
      .insert({
        user_id: userId,
        provider: 'tap',
        type: 'wallet_topup',
        status: 'pending',
        amount_aed: amountAed,
        fee_aed: 0,
        net_amount_aed: amountAed,
        provider_payment_id: charge.id,
        provider_customer_id: customerId,
        metadata: {
          phone: userPhone,
          charge_url: charge.transaction?.url,
        },
        created_at: db.fn.now(),
      })
      .returning('*');

    return {
      ok: true,
      charge_id: charge.id,
      transaction_id: transaction.id,
      payment_url: charge.transaction?.url, // URL to redirect user to
      amount: amountAed,
      status: charge.status,
    };
  } catch (error) {
    console.error('Tap create charge error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.data?.code,
    };
  }
}

/**
 * Handle successful payment webhook
 */
async function handlePaymentSuccess(chargeId, chargeData) {
  const trx = await db.transaction();

  try {
    // Find our transaction
    const transaction = await trx('payment_transactions')
      .where({ provider_payment_id: chargeId })
      .first();

    if (!transaction) {
      await trx.rollback();
      console.error('Tap transaction not found:', chargeId);
      return { ok: false, error: 'Transaction not found' };
    }

    // Don't process if already succeeded
    if (transaction.status === 'succeeded') {
      await trx.commit();
      return { ok: true, already_processed: true };
    }

    // Get payment method details
    const card = chargeData.card || chargeData.source?.payment_method;
    let cardLast4 = null;
    let cardBrand = null;
    let paymentMethodType = 'card';

    if (card) {
      cardLast4 = card.last_four;
      cardBrand = card.brand; // VISA, MASTERCARD, MADA, AMEX
      paymentMethodType = card.brand === 'MADA' ? 'mada' : 'card';
    }

    // Update transaction status
    await trx('payment_transactions')
      .where({ id: transaction.id })
      .update({
        status: 'succeeded',
        succeeded_at: trx.fn.now(),
        payment_method_type: paymentMethodType,
        card_last4: cardLast4,
        card_brand: cardBrand,
        updated_at: trx.fn.now(),
      });

    // Credit wallet based on transaction type
    if (transaction.type === 'wallet_topup') {
      const { addWalletBalance } = require('../controllers/walletController');
      await addWalletBalance(
        transaction.user_id,
        transaction.net_amount_aed,
        `Wallet topup via ${cardBrand || 'card'} ****${cardLast4 || '****'}`,
        transaction.id,
        'topup',
        trx
      );

      // Give reward points for topup >= 100 AED
      if (Number(transaction.net_amount_aed) >= 100) {
        const { addPoints } = require('../controllers/rewardController');
        await addPoints(transaction.user_id, 20, 'wallet_topup', transaction.id, trx);
      }
    }

    await trx.commit();

    return {
      ok: true,
      transaction_id: transaction.id,
      amount: transaction.amount_aed,
    };
  } catch (error) {
    await trx.rollback();
    console.error('Handle Tap payment success error:', error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * Handle failed payment webhook
 */
async function handlePaymentFailed(chargeId, errorMessage, errorCode) {
  try {
    await db('payment_transactions')
      .where({ provider_payment_id: chargeId })
      .update({
        status: 'failed',
        failed_at: db.fn.now(),
        error_message: errorMessage,
        error_code: errorCode,
        updated_at: db.fn.now(),
      });

    return { ok: true };
  } catch (error) {
    console.error('Handle Tap payment failed error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Create refund
 */
async function createRefund(transactionId, amountAed, reason) {
  const trx = await db.transaction();

  try {
    const transaction = await trx('payment_transactions')
      .where({ id: transactionId })
      .first();

    if (!transaction) {
      await trx.rollback();
      return { ok: false, error: 'Transaction not found' };
    }

    if (transaction.status !== 'succeeded') {
      await trx.rollback();
      return { ok: false, error: 'Can only refund succeeded payments' };
    }

    // Create Tap refund
    const refundAmount = amountAed || transaction.amount_aed;

    const response = await tapClient.post(`/charges/${transaction.provider_payment_id}/refund`, {
      amount: refundAmount,
      currency: 'AED',
      reason: reason || 'requested_by_customer',
      metadata: {
        glowee_transaction_id: transactionId,
      },
    });

    // Update transaction
    await trx('payment_transactions')
      .where({ id: transactionId })
      .update({
        status: 'refunded',
        refunded_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    // Deduct from wallet
    const { spendWalletBalance } = require('../controllers/walletController');
    await spendWalletBalance(
      transaction.user_id,
      refundAmount,
      `Refund for payment ${transaction.provider_payment_id}`,
      transactionId,
      'refund',
      trx
    );

    await trx.commit();

    return {
      ok: true,
      refund_id: response.data.id,
      amount: refundAmount,
    };
  } catch (error) {
    await trx.rollback();
    console.error('Tap create refund error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Retrieve charge status from Tap
 */
async function getChargeStatus(chargeId) {
  try {
    const response = await tapClient.get(`/charges/${chargeId}`);
    const charge = response.data;

    return {
      ok: true,
      status: charge.status, // INITIATED, AUTHORIZED, CAPTURED, FAILED, CANCELLED
      amount: charge.amount,
      currency: charge.currency,
      card: charge.card ? {
        last4: charge.card.last_four,
        brand: charge.card.brand,
      } : null,
    };
  } catch (error) {
    console.error('Tap get charge status error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Get payment transaction status
 */
async function getPaymentStatus(transactionId) {
  try {
    const transaction = await db('payment_transactions')
      .where({ id: transactionId })
      .first();

    if (!transaction) {
      return { ok: false, error: 'Transaction not found' };
    }

    return {
      ok: true,
      status: transaction.status,
      amount: Number(transaction.amount_aed),
      provider: transaction.provider,
      created_at: transaction.created_at,
      succeeded_at: transaction.succeeded_at,
      payment_method: {
        type: transaction.payment_method_type,
        card_last4: transaction.card_last4,
        card_brand: transaction.card_brand,
      },
    };
  } catch (error) {
    console.error('Get payment status error:', error);
    return {
      ok: false,
      error: error.message,
    };
  }
}

/**
 * List saved cards for user (if save_card was enabled)
 */
async function listSavedCards(userId) {
  try {
    const transaction = await db('payment_transactions')
      .where({ user_id: userId, provider: 'tap' })
      .whereNotNull('provider_customer_id')
      .first();

    if (!transaction?.provider_customer_id) {
      return { ok: true, cards: [] };
    }

    const response = await tapClient.get(`/customers/${transaction.provider_customer_id}`);
    const customer = response.data;

    const cards = (customer.sources || []).map(source => ({
      id: source.id,
      last4: source.last_four,
      brand: source.brand,
      exp_month: source.exp_month,
      exp_year: source.exp_year,
    }));

    return {
      ok: true,
      cards,
    };
  } catch (error) {
    console.error('Tap list saved cards error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

// src/services/tap.js - UPDATE createBookingCharge and createGiftCharge

/**
 * Create payment charge for booking (with optional split payment metadata)
 */
async function createBookingCharge(userId, bookingId, amountAed, userPhone, userName, userEmail, metadata = {}) {
  try {
    const booking = await db('bookings').where({ id: bookingId }).first();
    
    if (!booking) {
      return { ok: false, error: 'Booking not found' };
    }

    // Get or create Tap customer
    let customerId = null;
    const existingPayment = await db('payment_transactions')
      .where({ user_id: userId, provider: 'tap' })
      .whereNotNull('provider_customer_id')
      .first();

    if (existingPayment?.provider_customer_id) {
      customerId = existingPayment.provider_customer_id;
    }

    const description = metadata.split_payment 
      ? `Glowee Booking (Split Payment) - AED ${amountAed}`
      : `Glowee Booking Payment - AED ${amountAed}`;

    // Create charge
    const response = await tapClient.post('/charges', {
      amount: amountAed,
      currency: 'AED',
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      description,
      metadata: {
        glowee_user_id: userId.toString(),
        type: 'booking_payment',
        booking_id: bookingId,
        ...metadata,
      },
      receipt: {
        email: true,
        sms: true,
      },
      customer: customerId ? { id: customerId } : {
        first_name: userName?.split(' ')[0] || 'User',
        email: userEmail || `user${userId}@glowee.app`,
        phone: {
          country_code: '971',
          number: userPhone.replace('+971', '').replace(/\s/g, ''),
        },
      },
      source: {
        id: 'src_all',
      },
      post: {
        url: `${process.env.API_URL}/payments/webhooks/tap`,
      },
      redirect: {
        url: `${process.env.APP_URL}/bookings/${bookingId}/payment/success`,
      },
    });

    const charge = response.data;

    // Create payment transaction record
    const [transaction] = await db('payment_transactions')
      .insert({
        user_id: userId,
        provider: 'tap',
        type: 'booking_payment',
        status: 'pending',
        amount_aed: amountAed,
        fee_aed: 0,
        net_amount_aed: amountAed,
        provider_payment_id: charge.id,
        provider_customer_id: customerId,
        booking_id: bookingId,
        metadata: {
          phone: userPhone,
          charge_url: charge.transaction?.url,
          ...metadata,
        },
        created_at: db.fn.now(),
      })
      .returning('*');

    return {
      ok: true,
      charge_id: charge.id,
      transaction_id: transaction.id,
      payment_url: charge.transaction?.url,
      amount: amountAed,
      status: charge.status,
    };
  } catch (error) {
    console.error('Tap create booking charge error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.data?.code,
    };
  }
}

/**
 * Create payment charge for gift purchase
 */
async function createGiftCharge(userId, amountAed, recipientPhone, userPhone, userName, userEmail, metadata = {}) {
  try {
    // Get or create Tap customer
    let customerId = null;
    const existingPayment = await db('payment_transactions')
      .where({ user_id: userId, provider: 'tap' })
      .whereNotNull('provider_customer_id')
      .first();

    if (existingPayment?.provider_customer_id) {
      customerId = existingPayment.provider_customer_id;
    }

    const giftType = metadata.gift_type || 'service';
    const description = metadata.split_payment
      ? `Glowee Gift (Split Payment) - AED ${amountAed}`
      : `Glowee ${giftType === 'money' ? 'Money' : 'Service'} Gift - AED ${amountAed}`;

    // Create charge
    const response = await tapClient.post('/charges', {
      amount: amountAed,
      currency: 'AED',
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      description,
      metadata: {
        glowee_user_id: userId.toString(),
        type: 'gift_purchase',
        recipient_phone: recipientPhone,
        ...metadata,
      },
      receipt: {
        email: true,
        sms: true,
      },
      customer: customerId ? { id: customerId } : {
        first_name: userName?.split(' ')[0] || 'User',
        email: userEmail || `user${userId}@glowee.app`,
        phone: {
          country_code: '971',
          number: userPhone.replace('+971', '').replace(/\s/g, ''),
        },
      },
      source: {
        id: 'src_all',
      },
      post: {
        url: `${process.env.API_URL}/payments/webhooks/tap`,
      },
      redirect: {
        url: `${process.env.APP_URL}/gifts/payment/success`,
      },
    });

    const charge = response.data;

    // Create payment transaction record
    const [transaction] = await db('payment_transactions')
      .insert({
        user_id: userId,
        provider: 'tap',
        type: 'gift_purchase',
        status: 'pending',
        amount_aed: amountAed,
        fee_aed: 0,
        net_amount_aed: amountAed,
        provider_payment_id: charge.id,
        provider_customer_id: customerId,
        gift_id: metadata.gift_id || null,
        metadata: {
          phone: userPhone,
          recipient_phone: recipientPhone,
          charge_url: charge.transaction?.url,
          ...metadata,
        },
        created_at: db.fn.now(),
      })
      .returning('*');

    return {
      ok: true,
      charge_id: charge.id,
      transaction_id: transaction.id,
      payment_url: charge.transaction?.url,
      amount: amountAed,
      status: charge.status,
    };
  } catch (error) {
    console.error('Tap create gift charge error:', error.response?.data || error.message);
    return {
      ok: false,
      error: error.response?.data?.message || error.message,
      code: error.response?.data?.code,
    };
  }
}


module.exports = {
  createTapCustomer,
  createWalletTopupCharge,
  handlePaymentSuccess,
  handlePaymentFailed,
  createRefund,
  getChargeStatus,
  getPaymentStatus,
  listSavedCards,
  createBookingCharge,
  createGiftCharge,
};