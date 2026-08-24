exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Method Not Allowed"
      })
    };
  }

  try {
    const data = JSON.parse(event.body || "{}");

    const orderNumber = String(data.orderNumber || "").trim();
    const customerName = String(data.customerName || "").trim();
    const customerEmail = String(data.customerEmail || "").trim();
    const whatsapp = String(data.whatsapp || "").trim();
    const paymentMethod = String(data.paymentMethod || "").trim();
    const amount = Number(data.amount || 0);

    const fileName = String(data.fileName || "").trim();
    const fileType = String(data.fileType || "").trim();
    const fileBase64 = String(data.fileBase64 || "");

    if (
      !orderNumber ||
      !customerName ||
      !customerEmail ||
      !fileName ||
      !fileBase64
    ) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Data konfirmasi atau bukti transfer belum lengkap."
        })
      };
    }

    if (!customerEmail.includes("@")) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Alamat email tidak valid."
        })
      };
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf"
    ];

    if (!allowedTypes.includes(fileType)) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Format bukti transfer harus JPG, PNG, WEBP, atau PDF."
        })
      };
    }

    /*
     * Batasi ukuran file sekitar 5 MB.
     * Base64 biasanya lebih besar daripada file asli,
     * sehingga kita menggunakan batas sekitar 7 MB pada string.
     */
    if (fileBase64.length > 7 * 1024 * 1024) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Ukuran bukti transfer terlalu besar. Maksimal sekitar 5 MB."
        })
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL belum tersedia.");
    }

    if (!serviceKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY belum tersedia.");
    }

    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY belum tersedia.");
    }

    if (!fromEmail) {
      throw new Error("RESEND_FROM_EMAIL belum tersedia.");
    }

    const supabaseHeaders = {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
      "Content-Type": "application/json"
    };

    /*
     * 1. Cari pesanan berdasarkan nomor pesanan.
     */
    const orderResponse = await fetch(
      supabaseUrl +
        "/rest/v1/orders?order_number=eq." +
        encodeURIComponent(orderNumber) +
        "&select=id,order_number,customer_id,total_amount,status,payment_proof_url",
      {
        method: "GET",
        headers: supabaseHeaders
      }
    );

    if (!orderResponse.ok) {
      throw new Error(
        "Gagal mengambil data pesanan dari Supabase."
      );
    }

    const orders = await orderResponse.json();

    if (!orders.length) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Nomor pesanan tidak ditemukan."
        })
      };
    }

    const order = orders[0];

    /*
     * Jangan menerima konfirmasi ulang jika sudah diverifikasi.
     */
    if (String(order.status).toLowerCase() === "paid") {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Pesanan ini sudah ditandai sebagai sudah dibayar."
        })
      };
    }

    /*
     * 2. Ambil data customer.
     */
    const customerResponse = await fetch(
      supabaseUrl +
        "/rest/v1/customers?id=eq." +
        encodeURIComponent(order.customer_id) +
        "&select=id,full_name,email,whatsapp",
      {
        method: "GET",
        headers: supabaseHeaders
      }
    );

    if (!customerResponse.ok) {
      throw new Error(
        "Gagal mengambil data pelanggan dari Supabase."
      );
    }

    const customers = await customerResponse.json();

    if (!customers.length) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Data pelanggan untuk pesanan tidak ditemukan."
        })
      };
    }

    const customer = customers[0];

    /*
     * 3. Pastikan email yang digunakan saat konfirmasi
     * cocok dengan email pelanggan pada pesanan.
     */
    if (
      customer.email &&
      customer.email.toLowerCase() !== customerEmail.toLowerCase()
    ) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error:
            "Email tidak cocok dengan email yang digunakan saat membuat pesanan."
        })
      };
    }

    /*
     * 4. Bersihkan nama file.
     */
    const safeFileName = fileName
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-100);

    const extension =
      safeFileName.includes(".")
        ? safeFileName.substring(
            safeFileName.lastIndexOf(".")
          )
        : "";

    const storagePath =
      "orders/" +
      orderNumber +
      "/" +
      Date.now() +
      "_" +
      Math.random().toString(36).substring(2, 10) +
      extension;

    /*
     * 5. Ubah Base64 menjadi binary.
     */
    const binary = Buffer.from(fileBase64, "base64");

    /*
     * 6. Upload bukti transfer ke Storage private.
     */
    const uploadResponse = await fetch(
      supabaseUrl +
        "/storage/v1/object/payment-proofs/" +
        storagePath,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + serviceKey,
          "apikey": serviceKey,
          "Content-Type": fileType,
          "x-upsert": "false"
        },
        body: binary
      }
    );

    if (!uploadResponse.ok) {
      const uploadError = await uploadResponse.text();

      throw new Error(
        "Upload bukti transfer gagal: " + uploadError
      );
    }

    /*
     * 7. Buat URL internal/path.
     * File tetap private.
     */
    const proofPath = storagePath;

    /*
     * 8. Update order.
     */
    const updateResponse = await fetch(
      supabaseUrl +
        "/rest/v1/orders?order_number=eq." +
        encodeURIComponent(orderNumber),
      {
        method: "PATCH",
        headers: {
          ...supabaseHeaders,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          payment_proof_url: proofPath,
          payment_proof_uploaded_at: new Date().toISOString()
        })
      }
    );

    if (!updateResponse.ok) {
      throw new Error(
        "Gagal memperbarui bukti pembayaran pada pesanan."
      );
    }

    /*
     * 9. Simpan catatan konfirmasi.
     */
    const confirmationResponse = await fetch(
      supabaseUrl +
        "/rest/v1/payment_confirmations",
      {
        method: "POST",
        headers: {
          ...supabaseHeaders,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          order_number: orderNumber,
          customer_name: customerName,
          customer_email: customerEmail,
          whatsapp: whatsapp || customer.whatsapp || null,
          payment_method: paymentMethod || null,
          amount: amount || order.total_amount || null,
          proof_path: proofPath,
          status: "pending"
        })
      }
    );

    if (!confirmationResponse.ok) {
      const confirmationError =
        await confirmationResponse.text();

      throw new Error(
        "Gagal menyimpan konfirmasi pembayaran: " +
          confirmationError
      );
    }

    /*
     * 10. Buat signed URL sementara untuk admin.
     * File tetap private.
     */
    let proofUrl = "";

    const signedResponse = await fetch(
      supabaseUrl +
        "/storage/v1/object/sign/payment-proofs/" +
        storagePath,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + serviceKey,
          "apikey": serviceKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          expiresIn: 86400
        })
      }
    );

    if (signedResponse.ok) {
      const signedData = await signedResponse.json();

      if (signedData.signedURL) {
        proofUrl =
          supabaseUrl +
          "/storage/v1" +
          signedData.signedURL;
      }
    }

    /*
     * 11. Email admin.
     */
    const adminEmailHtml =
      "<h2>GOLD HUNTER EA</h2>" +
      "<h3>🔔 KONFIRMASI PEMBAYARAN BARU</h3>" +
      "<hr>" +
      "<p><strong>Nomor Pesanan:</strong><br>" +
      orderNumber +
      "</p>" +
      "<p><strong>Nama Pembeli:</strong><br>" +
      customerName +
      "</p>" +
      "<p><strong>Email:</strong><br>" +
      customerEmail +
      "</p>" +
      "<p><strong>WhatsApp:</strong><br>" +
      (whatsapp || customer.whatsapp || "-") +
      "</p>" +
      "<p><strong>Metode Pembayaran:</strong><br>" +
      (paymentMethod || "-") +
      "</p>" +
      "<p><strong>Jumlah Transfer:</strong><br>" +
      (amount || order.total_amount || "-") +
      "</p>" +
      "<p><strong>Status:</strong><br>" +
      "MENUNGGU VERIFIKASI ADMIN" +
      "</p>" +
      (proofUrl
        ? "<p><strong>Bukti Transfer:</strong><br>" +
          '<a href="' +
          proofUrl +
          '">BUKA BUKTI TRANSFER</a></p>'
        : "<p>Bukti transfer tersimpan di Supabase Storage.</p>") +
      "<hr>" +
      "<p>Silakan periksa rekening dan bukti transfer sebelum memberikan lisensi EA.</p>";

    /*
     * 12. Email pembeli.
     */
    const customerEmailHtml =
      "<h2>GOLD HUNTER EA</h2>" +
      "<p>Halo " +
      customerName +
      ",</p>" +
      "<p>Konfirmasi pembayaran Anda sudah kami terima.</p>" +
      "<hr>" +
      "<p><strong>Nomor Pesanan:</strong><br>" +
      orderNumber +
      "</p>" +
      "<p><strong>Metode Pembayaran:</strong><br>" +
      (paymentMethod || "-") +
      "</p>" +
      "<p><strong>Jumlah Transfer:</strong><br>" +
      (amount || order.total_amount || "-") +
      "</p>" +
      "<p><strong>Status:</strong><br>" +
      "MENUNGGU VERIFIKASI ADMIN" +
      "</p>" +
      "<hr>" +
      "<p>Terima kasih. Admin GOLD HUNTER EA akan memeriksa pembayaran Anda.</p>" +
      "<p>Setelah pembayaran diverifikasi, proses lisensi EA akan dilanjutkan.</p>";

    /*
     * 13. Kirim kedua email melalui Resend.
     */
    const emailRequests = [
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + resendApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: ["ghunterea@gmail.com"],
          subject:
            "🔔 KONFIRMASI PEMBAYARAN - " +
            orderNumber,
          html: adminEmailHtml
        })
      }),

      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + resendApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [customerEmail],
          subject:
            "GOLD HUNTER EA - Konfirmasi Pembayaran " +
            orderNumber,
          html: customerEmailHtml
        })
      })
    ];

    const emailResults =
      await Promise.all(emailRequests);

    const failedEmail =
      emailResults.find(function (response) {
        return !response.ok;
      });

    if (failedEmail) {
      console.error(
        "Salah satu email gagal dikirim:",
        await failedEmail.text()
      );
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: true,
        message:
          "Konfirmasi pembayaran berhasil dikirim.",
        orderNumber: orderNumber
      })
    };
  } catch (error) {
    console.error(
      "CONFIRM PAYMENT ERROR:",
      error
    );

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
