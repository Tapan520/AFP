// ?? AFP PAYMENT MODULE ????????????????????????????????????????????????????????
// Handles the full Razorpay payment flow for:
//   - Pet Registration  (?200)
//   - Licence Renewal   (?150)
//   - Ownership Transfer (?100)
// ?????????????????????????????????????????????????????????????????????????????

const Payment = (() => {

    const FEES = { registration: 200, renewal: 150, transfer: 100 };

    let _opts    = null;
    let _orderId = null;
    let _keyId   = null;

    // ?? Public: open the payment summary modal ????????????????????????????????
    function openPaymentModal(opts) {
        _opts = opts;
        const fee = FEES[opts.purpose] ?? 200;
        const labels = {
            registration: "Annual Pet Registration Licence",
            renewal:      "Licence Renewal",
            transfer:     "Ownership Transfer",
        };

        const el = document.getElementById("pay-modal");
        if (!el) { _startPaymentDirect(opts); return; }

        document.getElementById("pay-purpose-label").textContent = labels[opts.purpose] ?? "Payment";
        document.getElementById("pay-pet-name").textContent      = opts.petName ?? "";
        document.getElementById("pay-amount").textContent        = `\u20B9 ${fee}`;
        document.getElementById("pay-err").innerHTML             = "";
        document.getElementById("pay-btn").classList.remove("loading");
        document.getElementById("pay-btn").disabled              = false;

        document.querySelectorAll(".pay-method-chip").forEach(c => c.classList.remove("active"));
        document.querySelector(".pay-method-chip[data-method='upi']")?.classList.add("active");

        // Show test-mode banner if configured (set by checking appsettings lazily)
        const testBannerId = "pay-test-banner";
        let testBanner = document.getElementById(testBannerId);
        if (!testBanner) {
            testBanner = document.createElement("div");
            testBanner.id = testBannerId;
            testBanner.style.cssText =
                "background:#FFF3CD;border:1px solid #FFC107;border-radius:8px;padding:9px 12px;" +
                "font-size:12px;font-weight:600;color:#856404;margin-bottom:10px;display:none;";
            testBanner.innerHTML = "&#x1F9EA; <strong>TEST MODE</strong> &mdash; No real payment. Pet will be registered instantly.";
            const errEl = document.getElementById("pay-err");
            if (errEl) errEl.parentNode.insertBefore(testBanner, errEl);
        }
        // Hide initially; reveal only after CreateOrder confirms testMode
        testBanner.style.display = "none";

        el.style.display = "flex";
    }

    function closePaymentModal() {
        const el = document.getElementById("pay-modal");
        if (el) el.style.display = "none";
        if (_opts?.onCancel) _opts.onCancel();
        _opts = null; _orderId = null; _keyId = null;
    }

    // ?? Internal: create Razorpay order via .NET ??????????????????????????????
    async function _createOrder() {
        const res  = await fetch("/api/payment?handler=CreateOrder", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ purpose: _opts.purpose, petName: _opts.petName ?? "" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not initiate payment.");
        return data;
    }

    // ?? Internal: open Razorpay SDK popup (skipped in test mode) ??????????????
    function _openRazorpay(orderData) {
        // TEST MODE: server returned testMode=true — skip the Razorpay SDK entirely.
        // The synthetic orderId is passed straight to Verify, which auto-approves it.
        if (orderData.testMode || orderData.keyId === "rzp_test_mode") {
            return Promise.resolve({
                razorpay_order_id:   orderData.orderId,
                razorpay_payment_id: `test_pay_${Date.now()}`,
                razorpay_signature:  "test_signature",
            });
        }

        return new Promise((resolve, reject) => {
            if (!window.Razorpay) {
                reject(new Error("Payment gateway not available. Please try again."));
                return;
            }
            const options = {
                key:         orderData.keyId,
                amount:      orderData.amount,
                currency:    orderData.currency,
                name:        "All For Pets - Municipal Registry",
                description: `Pet licence: ${orderData.petName || ""}`,
                order_id:    orderData.orderId,
                prefill: {
                    name:    _opts.userName   ?? "",
                    email:   _opts.userEmail  ?? "",
                    contact: _opts.userMobile ?? "",
                },
                theme: { color: "#E8670A" },
                modal: { ondismiss: () => reject(new Error("Payment cancelled by user.")) },
                handler: (response) => resolve(response),
            };
            const rzp = new window.Razorpay(options);
            rzp.open();
        });
    }

    // ?? Internal: verify payment signature via .NET ???????????????????????????
    async function _verifyPayment(rzpResponse) {
        const res  = await fetch("/api/payment?handler=Verify", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                orderId:   rzpResponse.razorpay_order_id,
                paymentId: rzpResponse.razorpay_payment_id,
                signature: rzpResponse.razorpay_signature,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.verified) throw new Error(data.error || "Payment verification failed.");
        return data;
    }

    // ?? Fallback: direct payment when modal HTML is not present ???????????????
    async function _startPaymentDirect(opts) {
        _opts = opts;
        await startPayment();
    }

    // ?? Public: called by "Pay Now" button ????????????????????????????????????
    async function startPayment() {
        if (!_opts) return;

        const btn   = document.getElementById("pay-btn");
        const errEl = document.getElementById("pay-err");
        if (errEl) errEl.innerHTML = "";
        if (btn) { btn.classList.add("loading"); btn.disabled = true; }

        const processingEl = document.getElementById("pay-processing");

        try {
            const orderData  = await _createOrder();
            _orderId = orderData.orderId;
            _keyId   = orderData.keyId;

            // Show test-mode banner once we know the server is in test mode
            if (orderData.testMode) {
                const b = document.getElementById("pay-test-banner");
                if (b) b.style.display = "block";
            }

            const rzpResponse = await _openRazorpay(orderData);

            if (processingEl) processingEl.style.display = "flex";

            const verifyData = await _verifyPayment(rzpResponse);

            const payModal = document.getElementById("pay-modal");
            if (payModal) payModal.style.display = "none";
            if (processingEl) processingEl.style.display = "none";

            if (_opts.onSuccess) {
                _opts.onSuccess({
                    paymentId: verifyData.paymentId,
                    orderId:   verifyData.orderId,
                    txnRef:    verifyData.txnRef,
                });
            }
            _opts = null;

        } catch (ex) {
            if (processingEl) processingEl.style.display = "none";
            if (btn) { btn.classList.remove("loading"); btn.disabled = false; }

            const msg = ex.message || "Payment failed. Please try again.";
            if (errEl) {
                errEl.innerHTML = msg === "Payment cancelled by user."
                    ? alertBoxHTML("warn", "Payment cancelled. You can try again.")
                    : alertBoxHTML("err",  msg);
            } else {
                AFP.tst(msg);
            }
        }
    }

    return { openPaymentModal, closePaymentModal, startPayment, FEES };
})();
