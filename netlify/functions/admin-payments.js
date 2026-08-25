exports.handler = async function (event) {

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://goldhunterea.my.id",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        message: "Method tidak diizinkan."
      })
    };
  }

  try {

    const supabaseUrl =
      process.env.SUPABASE_URL;

    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authHeader =
      event.headers.authorization ||
      event.headers.Authorization ||
      "";

    if (!authHeader.startsWith("Bearer ")) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Admin belum login."
        })
      };
    }

    const accessToken =
      authHeader.substring(7);

    if (!supabaseUrl) {
      throw new Error(
        "SUPABASE_URL belum tersedia."
      );
    }

    if (!serviceKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY belum tersedia."
      );
    }

    /*
     * Validasi Access Token Admin
     */
    const userResponse = await fetch(
      supabaseUrl + "/auth/v1/user",
      {
        method: "GET",
        headers: {
          "apikey": serviceKey,
          "Authorization":
            "Bearer " + accessToken
        }
      }
    );

    if (!userResponse.ok) {
      const authError =
        await userResponse.text();

      console.error(
        "ADMIN AUTH ERROR:",
        userResponse.status,
        authError
      );

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Sesi Admin tidak valid atau sudah kedaluwarsa."
        })
      };
    }

    const adminUser =
      await userResponse.json();

    /*
     * Hanya email Admin yang diizinkan.
     */
    const adminEmail =
      String(adminUser.email || "")
        .toLowerCase();

    if (adminEmail !== "ghunterea@gmail.com") {
      console.error(
        "UNAUTHORIZED ADMIN EMAIL:",
        adminEmail
      );

      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Akun tidak memiliki akses Admin."
        })
      };
    }

    /*
     * Ambil pembayaran.
     */
    const response = await fetch(
      supabaseUrl +
      "/rest/v1/payment_confirmations" +
      "?select=*" +
      "&order=created_at.desc",
      {
        method: "GET",
        headers: {
          "apikey": serviceKey,
          "Authorization":
            "Bearer " + serviceKey,
          "Content-Type":
            "application/json"
        }
      }
    );

    const responseText =
      await response.text();

    if (!response.ok) {

      console.error(
        "SUPABASE ADMIN PAYMENTS ERROR:",
        response.status,
        responseText
      );

      throw new Error(
        "Gagal mengambil pembayaran dari Supabase. HTTP " +
        response.status
      );
    }

    let payments =
      JSON.parse(responseText);

    // Ambil data MT5 dan broker dari tabel customers.
    for (const payment of payments) {
      try {
        if (!payment.customer_id) {
          payment.mt5_account = null;
          payment.broker = null;
          continue;
        }

        const customerResponse = await fetch(
          supabaseUrl +
          "/rest/v1/customers" +
          "?select=mt5_account,broker" +
          "&id=eq." + encodeURIComponent(payment.customer_id) +
          "&limit=1",
          {
            method: "GET",
            headers: {
              "apikey": serviceKey,
              "Authorization": "Bearer " + serviceKey,
              "Content-Type": "application/json"
            }
          }
        );

        if (customerResponse.ok) {
          const customerRows = await customerResponse.json();
          const customer = customerRows[0];
          payment.mt5_account = customer ? customer.mt5_account : null;
          payment.broker = customer ? customer.broker : null;
        } else {
          payment.mt5_account = null;
          payment.broker = null;
        }
      } catch (customerError) {
        console.error("CUSTOMER DATA ERROR:", customerError);
        payment.mt5_account = null;
        payment.broker = null;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        payments: payments
      })
    };

  } catch (error) {

    console.error(
      "ADMIN PAYMENTS ERROR:",
      error
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: error.message
      })
    };
  }
};
