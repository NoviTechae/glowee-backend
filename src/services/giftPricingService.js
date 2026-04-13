const DEFAULT_GIFT_FEE_AED = Number(process.env.GIFT_FEE_AED || 3.95);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function calculateGiftSubtotal({ gift_type, amount_aed, service_items }) {
  if (gift_type === "money") {
    return round2(toNumber(amount_aed));
  }

  const items = Array.isArray(service_items) ? service_items : [];

  let subtotal = 0;
  for (const item of items) {
    const unitPrice = toNumber(
      item?.unit_price_aed ??
      item?.price_aed ??
      item?.price ??
      item?.amount ??
      0
    );

    const qty = Math.max(1, toNumber(item?.qty ?? item?.quantity ?? 1));
    subtotal += unitPrice * qty;
  }

  return round2(subtotal);
}

function calculateGiftPricing({ gift_type, amount_aed, service_items }) {
  const subtotal = calculateGiftSubtotal({
    gift_type,
    amount_aed,
    service_items,
  });

  const gift_fee = subtotal > 0 ? DEFAULT_GIFT_FEE_AED : 0;
  const total = round2(subtotal + gift_fee);

  return {
    subtotal: round2(subtotal),
    gift_fee: round2(gift_fee),
    total,
  };
}

module.exports = {
  calculateGiftPricing,
};