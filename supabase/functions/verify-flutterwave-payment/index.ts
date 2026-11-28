import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Nizzy_Hairbeauty â€” verify-flutterwave-payment
 *
 * Verifies a Flutterwave transaction server-side. An order is marked paid
 * only if Flutterwave confirms:
 *   - transaction status is successful
 *   - currency is NGN
 *   - tx_ref exactly matches an existing order_reference
 *   - amount exactly matches that order's subtotal_ngn (within 1 kobo)
 *
 * Required Supabase Edge Function secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FLW_SECRET_KEY
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, paid: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const flwSecretKey = Deno.env.get("FLW_SECRET_KEY");

    if (!supabaseUrl || !serviceKey || !flwSecretKey) {
      console.error("Missing payment verification server configuration.");
      return jsonResponse(
        { success: false, paid: false, error: "Payment verification is temporarily unavailable." },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();

    const transactionId = String(body.transaction_id ?? "").trim();
    const suppliedTxRef = String(body.tx_ref ?? body.order_reference ?? "").trim();

    if (!transactionId && !suppliedTxRef) {
      return jsonResponse(
        { success: false, paid: false, error: "Missing Flutterwave transaction ID or payment reference." },
        400,
      );
    }

    let verifyUrl: string;

    if (transactionId) {
      if (!/^\d+$/.test(transactionId)) {
        return jsonResponse(
          { success: false, paid: false, error: "Invalid Flutterwave transaction ID." },
          400,
        );
      }
      verifyUrl = `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`;
    } else {
      verifyUrl =
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(suppliedTxRef)}`;
    }

    const flutterwaveResponse = await fetch(verifyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${flwSecretKey}`,
        "Content-Type": "application/json",
      },
    });

    const flutterwaveJson = await flutterwaveResponse.json().catch(() => ({}));

    if (
      !flutterwaveResponse.ok ||
      flutterwaveJson.status !== "success" ||
      !flutterwaveJson.data
    ) {
      console.error("Flutterwave verification request failed:", flutterwaveJson);
      return jsonResponse(
        {
          success: false,
          paid: false,
          error:
            flutterwaveJson.message ||
            "Flutterwave has not confirmed this payment. Please try again shortly.",
        },
        400,
      );
    }

    const transaction = flutterwaveJson.data;
    const flutterwaveStatus = String(transaction.status ?? "").toLowerCase();
    const flutterwaveCurrency = String(transaction.currency ?? "").toUpperCase();
    const flutterwaveAmount = Number(transaction.amount);
    const verifiedTxRef = String(transaction.tx_ref ?? "").trim();

    if (!verifiedTxRef) {
      return jsonResponse(
        { success: false, paid: false, error: "Flutterwave did not return a valid order reference." },
        400,
      );
    }

    // If the browser supplied both values, the verified reference must match.
    if (suppliedTxRef && verifiedTxRef !== suppliedTxRef) {
      console.error("Flutterwave tx_ref mismatch.", {
        suppliedTxRef,
        verifiedTxRef,
      });
      return jsonResponse(
        { success: false, paid: false, error: "The payment reference does not match this order." },
        400,
      );
    }

    if (flutterwaveStatus !== "successful") {
      return jsonResponse(
        {
          success: false,
          paid: false,
          error: `Payment status is "${transaction.status ?? "unknown"}", not successful.`,
          order_reference: verifiedTxRef,
          flutterwave_status: transaction.status ?? null,
        },
        400,
      );
    }

    if (flutterwaveCurrency !== "NGN") {
      return jsonResponse(
        { success: false, paid: false, error: "Payment currency must be NGN." },
        400,
      );
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, order_reference, subtotal_ngn, payment_status, payment_method, flutterwave_transaction_id")
      .eq("order_reference", verifiedTxRef)
      .maybeSingle();

    if (orderError || !order) {
      console.error("Order lookup failed:", orderError);
      return jsonResponse(
        { success: false, paid: false, error: "No matching order was found for this payment." },
        404,
      );
    }

    const payableMethod = String(order.payment_method || "").toLowerCase();
    if (payableMethod !== "card" && payableMethod !== "bank_transfer") {
      return jsonResponse(
        { success: false, paid: false, error: "This order is not eligible for Flutterwave payment verification." },
        403,
      );
    }

    const verifiedTransactionId = String(transaction.id ?? transactionId).trim();
    if (!/^\d+$/.test(verifiedTransactionId)) {
      return jsonResponse(
        { success: false, paid: false, error: "Flutterwave did not return a valid transaction ID." },
        400,
      );
    }

    const expectedAmount = Number(order.subtotal_ngn);

    if (
      !Number.isFinite(flutterwaveAmount) ||
      !Number.isFinite(expectedAmount) ||
      Math.abs(flutterwaveAmount - expectedAmount) > 0.01
    ) {
      console.error("Flutterwave amount mismatch.", {
        flutterwaveAmount,
        expectedAmount,
        orderReference: order.order_reference,
      });
      return jsonResponse(
        {
          success: false,
          paid: false,
          error: "The amount paid does not match the order amount. Please contact the shop.",
          order_reference: order.order_reference,
        },
        400,
      );
    }

    // Idempotent response if Flutterwave redirects/retries more than once.
    if (String(order.payment_status ?? "").toLowerCase() === "paid") {
      if (order.flutterwave_transaction_id && String(order.flutterwave_transaction_id) !== verifiedTransactionId) {
        return jsonResponse(
          { success: false, paid: false, error: "This order was already paid using a different transaction." },
          409,
        );
      }
      return jsonResponse({
        success: true,
        paid: true,
        already_paid: true,
        order_reference: order.order_reference,
        order_id: order.id,
        payment_status: "paid",
        amount_ngn: expectedAmount,
        currency: "NGN",
        message: "This order has already been marked as paid.",
      });
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: "paid", flutterwave_transaction_id: verifiedTransactionId })
      .eq("id", order.id)
      .eq("payment_status", "unpaid")
      .select("id, order_reference, payment_status")
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") {
        return jsonResponse(
          { success: false, paid: false, error: "This Flutterwave transaction has already been used for another order." },
          409,
        );
      }
      console.error("Could not update order payment status:", updateError);
      return jsonResponse(
        {
          success: false,
          paid: false,
          error: "Payment was verified, but the order record could not be updated. Please contact the shop.",
          order_reference: order.order_reference,
        },
        500,
      );
    }

    if (!updatedOrder) {
      // Another request may have completed the update at the same time.
      const { data: latestOrder, error: latestError } = await supabase
        .from("orders")
        .select("id, order_reference, payment_status, flutterwave_transaction_id")
        .eq("id", order.id)
        .maybeSingle();

      if (latestError || !latestOrder || String(latestOrder.payment_status).toLowerCase() !== "paid" ||
          String(latestOrder.flutterwave_transaction_id || "") !== verifiedTransactionId) {
        return jsonResponse(
          {
            success: false,
            paid: false,
            error: "Payment was verified, but the order could not be marked as paid. Please contact the shop.",
            order_reference: order.order_reference,
          },
          500,
        );
      }
    }

    return jsonResponse({
      success: true,
      paid: true,
      order_reference: order.order_reference,
      order_id: order.id,
      payment_status: "paid",
      amount_ngn: expectedAmount,
      currency: "NGN",
      flutterwave_status: transaction.status,
      message: "Payment verified successfully. Your order is marked as paid.",
    });
  } catch (error) {
    console.error("verify-flutterwave-payment error:", error);
    return jsonResponse(
      { success: false, paid: false, error: "Something went wrong while verifying payment. Please try again." },
      500,
    );
  }
});
