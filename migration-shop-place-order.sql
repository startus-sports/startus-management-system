-- ============================================
-- STARTUS Shop: Order Placement RPC + Stripe Payment Success
-- Run this ONCE in the shop's Supabase SQL Editor
-- (vezyjwejdxtzhchzsnfn.supabase.co)
-- ============================================

-- ============================================
-- Add stripeSessionId column to orders table
-- ============================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "stripeSessionId" TEXT;

-- ============================================
-- RPC: Place order (atomic: create order + reserve inventory)
-- ============================================
CREATE OR REPLACE FUNCTION shop_place_order(
  p_buyer_name TEXT,
  p_buyer_email TEXT,
  p_buyer_phone TEXT,
  p_student_class TEXT,
  p_payment_method TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id UUID;
  v_order_number TEXT;
  v_total_amount INT := 0;
  v_item JSONB;
  v_available INT;
  v_status TEXT;
  v_seq INT;
BEGIN
  -- Determine initial status
  IF p_payment_method = 'cash' THEN
    v_status := 'pending';
  ELSIF p_payment_method = 'stripe' THEN
    v_status := 'pending_payment';
  ELSE
    RETURN jsonb_build_object('error', 'INVALID_PAYMENT_METHOD');
  END IF;

  -- Generate order number: KSC-YYYY-NNNNN
  SELECT COALESCE(MAX(
    CASE WHEN "orderNumber" ~ '^KSC-\d{4}-\d{5}$'
    THEN CAST(SUBSTRING("orderNumber" FROM 10 FOR 5) AS INT)
    ELSE 0 END
  ), 0) + 1 INTO v_seq FROM orders;

  v_order_number := 'KSC-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(v_seq::TEXT, 5, '0');

  -- Validate stock for all items (with row locks)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT "quantityAvailable" INTO v_available
    FROM inventory
    WHERE "variantId" = (v_item->>'variantId')::UUID
    FOR UPDATE;

    IF v_available IS NULL THEN
      RETURN jsonb_build_object('error', 'VARIANT_NOT_FOUND',
        'variantId', v_item->>'variantId');
    END IF;

    IF v_available < (v_item->>'quantity')::INT THEN
      RETURN jsonb_build_object('error', 'INSUFFICIENT_STOCK',
        'variantId', v_item->>'variantId',
        'available', v_available,
        'requested', (v_item->>'quantity')::INT);
    END IF;

    v_total_amount := v_total_amount + (v_item->>'unitPrice')::INT * (v_item->>'quantity')::INT;
  END LOOP;

  -- Create order
  INSERT INTO orders (
    "orderNumber", status, "paymentMethod",
    "buyerName", "buyerEmail", "buyerPhone",
    "studentClass", notes, "totalAmount"
  )
  VALUES (
    v_order_number, v_status, p_payment_method,
    p_buyer_name, p_buyer_email, p_buyer_phone,
    p_student_class, p_notes, v_total_amount
  )
  RETURNING id INTO v_order_id;

  -- Create order items and reserve inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO order_items (
      "orderId", "variantId",
      "productNameSnapshot", "variantSizeSnapshot",
      "variantColorSnapshot", "variantSkuSnapshot",
      "unitPrice", quantity, "lineTotal"
    )
    VALUES (
      v_order_id,
      (v_item->>'variantId')::UUID,
      v_item->>'productName',
      v_item->>'variantSize',
      v_item->>'variantColor',
      v_item->>'variantSku',
      (v_item->>'unitPrice')::INT,
      (v_item->>'quantity')::INT,
      (v_item->>'unitPrice')::INT * (v_item->>'quantity')::INT
    );

    UPDATE inventory SET
      "quantityAvailable" = "quantityAvailable" - (v_item->>'quantity')::INT,
      "quantityReserved" = "quantityReserved" + (v_item->>'quantity')::INT,
      "updatedAt" = NOW()
    WHERE "variantId" = (v_item->>'variantId')::UUID;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'totalAmount', v_total_amount
  );
END;
$$;

-- ============================================
-- RPC: Stripe payment success
-- reserved -> sold, status -> paid
-- ============================================
CREATE OR REPLACE FUNCTION shop_stripe_payment_success(
  p_order_id TEXT,
  p_stripe_session_id TEXT
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

  IF v_order.status != 'pending_payment' THEN
    RETURN jsonb_build_object('error', 'ORDER_NOT_PENDING_PAYMENT');
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
    "stripeSessionId" = p_stripe_session_id,
    "updatedAt" = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'orderId', p_order_id);
END;
$$;

-- ============================================
-- Fix: shop_cancel_order for pending_payment
-- Should move reserved -> available (not sold -> available)
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
    -- Both pending (cash) and pending_payment (stripe) have reserved inventory
    UPDATE inventory SET
      "quantityReserved" = "quantityReserved" - v_item.quantity,
      "quantityAvailable" = "quantityAvailable" + v_item.quantity,
      "updatedAt" = NOW()
    WHERE "variantId" = v_item."variantId";
  END LOOP;

  UPDATE orders SET
    status = 'cancelled',
    "updatedAt" = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'orderId', p_order_id);
END;
$$;
