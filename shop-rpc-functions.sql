-- ============================================
-- STARTUS Shop: RPC Functions for Management System
-- Run this in the shop's Supabase SQL Editor
-- (vezyjwejdxtzhchzsnfn.supabase.co)
-- ============================================

-- ============================================
-- RPC: Confirm cash payment (transactional)
-- reserved -> sold, status -> paid
-- ============================================
CREATE OR REPLACE FUNCTION shop_confirm_cash_payment(
  p_order_id TEXT,
  p_admin_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_admin_id TEXT;
BEGIN
  SELECT id INTO v_admin_id FROM admin_users WHERE email = p_admin_email LIMIT 1;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  IF v_order.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_PENDING');
  END IF;

  IF v_order."paymentMethod" != 'cash' THEN
    RETURN jsonb_build_object('error', 'NOT_CASH_ORDER');
  END IF;

  FOR v_item IN SELECT * FROM order_items WHERE "orderId" = p_order_id
  LOOP
    UPDATE inventory SET
      "quantityReserved" = "quantityReserved" - v_item.quantity,
      "quantitySold" = "quantitySold" + v_item.quantity,
      "updatedAt" = NOW()
    WHERE "variantId" = v_item."variantId";
  END LOOP;

  UPDATE orders SET
    status = 'paid',
    "paidAt" = NOW(),
    "confirmedByAdminId" = v_admin_id,
    "updatedAt" = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'orderId', p_order_id);
END;
$$;

-- ============================================
-- RPC: Cancel order (transactional)
-- Reverses inventory based on status/paymentMethod
-- ============================================
CREATE OR REPLACE FUNCTION shop_cancel_order(
  p_order_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND');
  END IF;

  IF v_order.status IN ('paid', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'CANNOT_CANCEL');
  END IF;

  FOR v_item IN SELECT * FROM order_items WHERE "orderId" = p_order_id
  LOOP
    IF v_order."paymentMethod" = 'cash' AND v_order.status = 'pending' THEN
      UPDATE inventory SET
        "quantityReserved" = "quantityReserved" - v_item.quantity,
        "quantityAvailable" = "quantityAvailable" + v_item.quantity,
        "updatedAt" = NOW()
      WHERE "variantId" = v_item."variantId";
    ELSIF v_order.status = 'pending_payment' THEN
      UPDATE inventory SET
        "quantitySold" = "quantitySold" - v_item.quantity,
        "quantityAvailable" = "quantityAvailable" + v_item.quantity,
        "updatedAt" = NOW()
      WHERE "variantId" = v_item."variantId";
    END IF;
  END LOOP;

  UPDATE orders SET
    status = 'cancelled',
    "updatedAt" = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'orderId', p_order_id);
END;
$$;
