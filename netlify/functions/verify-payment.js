exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://goldhunterea.my.id",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
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
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    const fromEmail =
      process.env.RESEND_FROM_EMAIL ||
      "GOLD HUNTER EA <noreply@goldhunterea.my.id>";

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL belum tersedia.");
    }

    if (!serviceKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY belum tersedia."
      );
    }

    if (!resendApiKey) {
      throw new Error(
        "RESEND_API_KEY belum tersedia."
      );
    }

    let body;

    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Data JSON tidak valid."
        })
      };
    }

    const orderNumber = String(
      body.order_number || ""
    ).trim();

    const packageId = String(
      body.package_id || ""
    ).trim();

    const mt5Account = String(
      body.mt5_account || ""
    ).trim();

    const broker = String(
      body.broker || ""
    ).trim();

    const verificationNote = String(
      body.verification_note || ""
    ).trim();

    if (!orderNumber) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Nomor pesanan wajib diisi."
        })
      };
    }

    if (!packageId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Paket lisensi wajib dipilih."
        })
      };
    }

    if (!mt5Account) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message:
            "Nomor akun MT5/HFM wajib diisi."
        })
      };
    }

    if (!broker) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Broker wajib diisi."
        })
      };
    }

    const supabaseHeaders = {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
      "Content-Type": "application/json"
    };

    /*
     * 1. Ambil pesanan.
     */

    const orderResponse = await fetch(
      supabaseUrl +
        "/rest/v1/orders" +
        "?order_number=eq." +
        encodeURIComponent(orderNumber) +
        "&select=*",
      {
        method: "GET",
        headers: supabaseHeaders
      }
    );

    const orderText = await orderResponse.text();

    if (!orderResponse.ok) {
      console.error(
        "VERIFY ORDER ERROR:",
        orderResponse.status,
        orderText
      );

      throw new Error(
        "Gagal mengambil pesanan. HTTP " +
          orderResponse.status
      );
    }

    const orders = JSON.parse(orderText);

    if (!orders.length) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Pesanan tidak ditemukan."
        })
      };
    }

    const order = orders[0];

    /*
     * 2. Pastikan belum diverifikasi.
     */

    if (
      String(order.status || "").toLowerCase() ===
      "paid"
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message:
            "Pesanan ini sudah diverifikasi."
        })
      };
    }

    /*
     * 3. Ambil paket lisensi.
     */

    const packageResponse = await fetch(
      supabaseUrl +
        "/rest/v1/license_packages" +
        "?id=eq." +
        encodeURIComponent(packageId) +
        "&select=*",
      {
        method: "GET",
        headers: supabaseHeaders
      }
    );

    const packageText =
      await packageResponse.text();

    if (!packageResponse.ok) {
      console.error(
        "VERIFY PACKAGE ERROR:",
        packageResponse.status,
        packageText
      );

      throw new Error(
        "Gagal mengambil paket lisensi. HTTP " +
          packageResponse.status
      );
    }

    const packages = JSON.parse(packageText);

    if (!packages.length) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          message:
            "Paket lisensi tidak ditemukan."
        })
      };
    }

    const licensePackage = packages[0];

    if (!licensePackage.is_active) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message:
            "Paket lisensi tidak aktif."
        })
      };
    }

    /*
     * 4. Ambil data customer.
     */

    let customer = null;

    if (order.customer_id) {
      const customerResponse = await fetch(
        supabaseUrl +
          "/rest/v1/customers" +
          "?id=eq." +
          encodeURIComponent(order.customer_id) +
          "&select=*",
        {
          method: "GET",
          headers: supabaseHeaders
        }
      );

      if (!customerResponse.ok) {
        const customerError =
          await customerResponse.text();

        console.error(
          "CUSTOMER ERROR:",
          customerResponse.status,
          customerError
        );
      } else {
        const customerData =
          await customerResponse.json();

        if (customerData.length) {
          customer = customerData[0];
        }
      }
    }

    /*
     * 5. Tentukan tanggal mulai dan berakhir.
     */

    const startDate = new Date();

    let expiryDate = null;

    const durationDays = Number(
      licensePackage.duration_days || 0
    );

    if (durationDays > 0) {
      expiryDate = new Date(startDate);

      expiryDate.setDate(
        expiryDate.getDate() + durationDays
      );
    }

    /*
     * 6. Buat License Key.
     */

    function randomPart(length) {
      const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

      let result = "";

      for (let i = 0; i < length; i++) {
        result += chars.charAt(
          Math.floor(
            Math.random() * chars.length
          )
        );
      }

      return result;
    }

    const licenseKey =
      "GHE-" +
      randomPart(4) +
      "-" +
      randomPart(4) +
      "-" +
      randomPart(4);

    /*
     * 7. Simpan lisensi.
     */

    const licensePayload = {
      license_key: licenseKey,

      customer_id:
        order.customer_id || null,

      order_id:
        order.id || null,

      product_id:
        order.product_id || null,

      mt5_account: mt5Account,

      broker: broker,

      start_at:
        startDate.toISOString(),

      expires_at:
        expiryDate
          ? expiryDate.toISOString()
          : null,

      status: "active",

      customer_email:
        customer?.email || null,

      customer_name:
        customer?.full_name || null,

      package_id:
        licensePackage.id,

      package_name:
        licensePackage.name,

      start_date:
        startDate.toISOString(),

      expiry_date:
        expiryDate
          ? expiryDate.toISOString()
          : null,

      activated_at:
        startDate.toISOString(),

      activated_by:
        "admin",

      notes:
        verificationNote ||
        "Dibuat melalui verifikasi pembayaran " +
        orderNumber
    };

    const licenseResponse = await fetch(
      supabaseUrl + "/rest/v1/licenses",
      {
        method: "POST",

        headers: {
          ...supabaseHeaders,
          "Prefer":
            "return=representation"
        },

        body: JSON.stringify(
          licensePayload
        )
      }
    );

    const licenseText =
      await licenseResponse.text();

    if (!licenseResponse.ok) {
      console.error(
        "CREATE LICENSE ERROR:",
        licenseResponse.status,
        licenseText
      );

      throw new Error(
        "Gagal membuat lisensi. HTTP " +
          licenseResponse.status +
          " - " +
          licenseText
      );
    }

    const createdLicenses =
      JSON.parse(licenseText);

    const license =
      createdLicenses[0] ||
      licensePayload;

    /*
     * 8. Update orders.
     */

    const verifiedAt =
      new Date().toISOString();

    const updateOrderResponse =
      await fetch(
        supabaseUrl +
          "/rest/v1/orders?id=eq." +
          encodeURIComponent(order.id),
        {
          method: "PATCH",

          headers: {
            ...supabaseHeaders,
            "Prefer":
              "return=minimal"
          },

          body: JSON.stringify({
            status: "paid",
            verified_at: verifiedAt,
            verified_by: "admin",
            verification_note:
              verificationNote ||
              "Pembayaran diverifikasi."
          })
        }
      );

    if (!updateOrderResponse.ok) {
      const updateError =
        await updateOrderResponse.text();

      console.error(
        "UPDATE ORDER ERROR:",
        updateOrderResponse.status,
        updateError
      );

      throw new Error(
        "Lisensi dibuat tetapi status pesanan gagal diperbarui."
      );
    }

    /*
     * 9. Update payment confirmation.
     */

    const confirmationResponse =
      await fetch(
        supabaseUrl +
          "/rest/v1/payment_confirmations" +
          "?order_number=eq." +
          encodeURIComponent(
            orderNumber
          ),
        {
          method: "PATCH",

          headers: {
            ...supabaseHeaders,
            "Prefer":
              "return=minimal"
          },

          body: JSON.stringify({
            status: "approved"
          })
        }
      );

    if (!confirmationResponse.ok) {
      const confirmationError =
        await confirmationResponse.text();

      console.error(
        "UPDATE CONFIRMATION ERROR:",
        confirmationResponse.status,
        confirmationError
      );
    }

    /*
     * 10. Email pelanggan.
     */

    const customerEmail =
      customer?.email || "";

    if (customerEmail) {
      const expiryText =
        expiryDate
          ? expiryDate.toLocaleDateString(
              "id-ID",
              {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
              }
            )
          : "TIDAK TERBATAS";

      const customerName =
        customer?.full_name ||
        "Pelanggan GOLD HUNTER EA";

      const customerEmailHtml =
        "<h2>GOLD HUNTER EA</h2>" +

        "<p>Halo " +
        customerName +
        ",</p>" +

        "<p>Pembayaran Anda telah " +
        "<strong>TERVERIFIKASI</strong>.</p>" +

        "<hr>" +

        "<p><strong>Nomor Pesanan:</strong><br>" +
        orderNumber +
        "</p>" +

        "<p><strong>License Key:</strong><br>" +
        "<strong>" +
        licenseKey +
        "</strong></p>" +

        "<p><strong>Paket:</strong><br>" +
        licensePackage.name +
        "</p>" +

        "<p><strong>Masa Aktif:</strong><br>" +
        (
          durationDays > 0
            ? durationDays + " hari"
            : "Tidak terbatas"
        ) +
        "</p>" +

        "<p><strong>Akun MT5:</strong><br>" +
        mt5Account +
        "</p>" +

        "<p><strong>Broker:</strong><br>" +
        broker +
        "</p>" +

        "<p><strong>Berlaku sampai:</strong><br>" +
        expiryText +
        "</p>" +

        "<hr>" +

        "<p>License Key ini terikat dengan " +
        "akun MT5 yang telah didaftarkan.</p>" +

        "<p>Gunakan License Key tersebut " +
        "pada GOLD HUNTER EA.</p>";

      const emailResponse =
        await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",

            headers: {
              "Authorization":
                "Bearer " +
                resendApiKey,

              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              from: fromEmail,

              to: [
                customerEmail
              ],

              subject:
                "GOLD HUNTER EA - " +
                "Lisensi Aktif " +
                orderNumber,

              html:
                customerEmailHtml
            })
          }
        );

      if (!emailResponse.ok) {
        const emailError =
          await emailResponse.text();

        console.error(
          "LICENSE EMAIL ERROR:",
          emailError
        );
      }
    }

    /*
     * 11. Response ke Admin.
     */

    return {
      statusCode: 200,

      headers,

      body: JSON.stringify({
        success: true,

        message:
          "Pembayaran berhasil diverifikasi dan lisensi berhasil dibuat.",

        license: {
          id:
            license.id || null,

          license_key:
            licenseKey,

          package_name:
            licensePackage.name,

          mt5_account:
            mt5Account,

          broker:
            broker,

          start_date:
            startDate.toISOString(),

          expiry_date:
            expiryDate
              ? expiryDate.toISOString()
              : null,

          status:
            "active",

          customer_email:
            customerEmail
        }
      })
    };

  } catch (error) {
    console.error(
      "VERIFY PAYMENT ERROR:",
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
