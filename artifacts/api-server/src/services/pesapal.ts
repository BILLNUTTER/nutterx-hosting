export interface PesapalConfig {
  consumerKey: string;
  consumerSecret: string;
  isProduction: boolean;
}

export interface PesapalOrder {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  email: string;
  phone?: string;
  callbackUrl: string;
  ipnId: string;
}

function baseUrl(isProduction: boolean) {
  return isProduction
    ? "https://pay.pesapal.com/v3"
    : "https://cybqa.pesapal.com/pesapalv3";
}

export async function getPesapalToken(config: PesapalConfig): Promise<string> {
  const res = await fetch(`${baseUrl(config.isProduction)}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      consumer_key: config.consumerKey,
      consumer_secret: config.consumerSecret,
    }),
  });
  if (!res.ok) throw new Error(`PesaPal auth failed: ${res.status}`);
  const data = (await res.json()) as { token?: string; error?: { message: string } };
  if (data.error?.message) throw new Error(data.error.message);
  if (!data.token) throw new Error("PesaPal returned no token");
  return data.token;
}

export async function registerIPNUrl(
  config: PesapalConfig,
  token: string,
  ipnUrl: string
): Promise<string> {
  const res = await fetch(`${baseUrl(config.isProduction)}/api/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: "GET" }),
  });
  if (!res.ok) throw new Error(`IPN registration failed: ${res.status}`);
  const data = (await res.json()) as { ipn_id?: string; error?: { message: string } };
  if (data.error?.message) throw new Error(data.error.message);
  return data.ipn_id ?? "";
}

export async function submitOrder(
  config: PesapalConfig,
  token: string,
  order: PesapalOrder
): Promise<{ orderTrackingId: string; redirectUrl: string }> {
  const res = await fetch(
    `${baseUrl(config.isProduction)}/api/Transactions/SubmitOrderRequest`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: order.orderId,
        currency: order.currency,
        amount: order.amount,
        description: order.description,
        callback_url: order.callbackUrl,
        notification_id: order.ipnId,
        billing_address: {
          email_address: order.email,
          phone_number: order.phone ?? "",
          first_name: "Nutterx",
          last_name: "User",
          country_code: "KE",
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Submit order failed: ${res.status}`);
  const data = (await res.json()) as {
    order_tracking_id?: string;
    redirect_url?: string;
    error?: { message: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  if (!data.redirect_url) throw new Error("PesaPal returned no redirect URL");
  return {
    orderTrackingId: data.order_tracking_id ?? "",
    redirectUrl: data.redirect_url,
  };
}

export async function getTransactionStatus(
  config: PesapalConfig,
  token: string,
  orderTrackingId: string
): Promise<{
  status: string;
  paymentMethod: string;
  amount: number;
  merchantReference: string;
}> {
  const res = await fetch(
    `${baseUrl(config.isProduction)}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  const data = (await res.json()) as {
    payment_status_description?: string;
    payment_method?: string;
    amount?: number;
    order_merchant_reference?: string;
    error?: { message: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  return {
    status: data.payment_status_description ?? "Unknown",
    paymentMethod: data.payment_method ?? "",
    amount: data.amount ?? 0,
    merchantReference: data.order_merchant_reference ?? "",
  };
}
