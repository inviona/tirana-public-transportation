import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { CreditCard, CheckCircle, X, ArrowUpRight, History, RefreshCw } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function PaymentModal({ amount, onClose, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError('');

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message);
      setLoading(false);
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setLoading(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === 'succeeded') {
      onSuccess(paymentIntent.id, amount);
    }
    setLoading(false);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'var(--accent)', borderRadius: 10, padding: 10 }}>
              <CreditCard size={20} color="#000" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>Payment Details</h3>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Top up {amount} L</p>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={styles.paymentElementWrapper}>
            <PaymentElement options={{
              layout: 'tabs',
              paymentMethodOrder: ['card', 'apple_pay', 'google_pay', 'sepa_debit']
            }} />
          </div>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          <div style={styles.modalFooter}>
            <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              Secured by Stripe. Test with card: 4242 4242 4242 4242
            </div>
            <button
              type="submit"
              disabled={loading || !stripe}
              style={styles.payButton}
              className="btn btn-primary"
            >
              {loading ? (
                <><RefreshCw size={16} className="spin" /> Processing...</>
              ) : (
                <><ArrowUpRight size={16} /> Pay {amount} L</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TOPUP_AMOUNTS = [200, 500, 1000, 2000, 5000];

export default function WalletPage() {
  const { token } = useAuth();
  const [balance, setBalance] = useState(0);
  const [selectedAmount, setSelectedAmount] = useState(500);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [modalLoading, setModalLoading] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const refreshBalance = async () => {
    if (!token) return;
    try {
      const res = await fetch('http://localhost:3001/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const userData = await res.json();
      if (userData && userData.balance !== undefined) {
        setBalance(userData.balance);
      }
    } catch (err) {
      console.error('Failed to fetch balance:', err);
    }
  };

  useEffect(() => {
    refreshBalance();
  }, [token]);

  const openPaymentModal = async () => {
    setModalLoading(true);
    try {
      const intentRes = await fetch('http://localhost:3001/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: selectedAmount }),
      });
      const intentData = await intentRes.json();

      if (!intentData.clientSecret) {
        showToast(intentData.error || 'Failed to initialize payment', 'error');
        setModalLoading(false);
        return;
      }

      setClientSecret(intentData.clientSecret);
      setShowModal(true);
    } catch (err) {
      showToast('Failed to initialize payment', 'error');
    }
    setModalLoading(false);
  };

  const handlePaymentSuccess = async (paymentIntentId, amount) => {
    try {
      const confirmRes = await fetch('http://localhost:3001/api/payments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paymentIntentId }),
      });
      const confirmData = await confirmRes.json();

      if (confirmData.success) {
        setBalance(confirmData.balance);
        showToast(`Successfully topped up ${amount} L!`);
        setShowModal(false);
      } else {
        showToast(confirmData.error || 'Payment succeeded but balance update failed', 'error');
      }
    } catch (err) {
      showToast('Failed to confirm payment', 'error');
    }
  };

  const appearance = {
    theme: 'night',
    variables: {
      colorPrimary: '#e8b84b',
      colorBackground: '#1a1f2e',
      colorText: '#e0e0e0',
      colorDanger: '#ef4444',
      fontFamily: 'system-ui, sans-serif',
      borderRadius: '8px',
    },
  };

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      {showModal && clientSecret && (
        <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
          <PaymentModal
            amount={selectedAmount}
            onClose={() => setShowModal(false)}
            onSuccess={handlePaymentSuccess}
          />
        </Elements>
      )}

      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24,
          background: toast.type === 'error' ? '#2d1f1f' : 'var(--bg2)',
          border: `1px solid ${toast.type === 'error' ? 'var(--red)' : 'var(--accent)'}`,
          borderRadius: 12, padding: '14px 20px', zIndex: 9999,
          fontWeight: 600, fontSize: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {toast.type === 'error' ? <X size={16} color="var(--red)" /> : <CheckCircle size={16} color="var(--accent3)" />}
          {toast.msg}
        </div>
      )}

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Wallet & Payments</h1>
        <p style={{ color: 'var(--muted)' }}>Add funds to your wallet using Apple Pay, Card, or SEPA Direct Debit.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <div style={{ background: 'linear-gradient(135deg, #1a2a4a 0%, #0e1528 100%)', border: '1px solid rgba(232,184,75,0.2)', borderRadius: 20, padding: 32, marginBottom: 24 }}>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8, fontWeight: 500, letterSpacing: 1 }}>WALLET BALANCE</div>
            <div style={{ fontFamily: 'Syne', fontSize: 52, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>
              {balance.toLocaleString()}<span style={{ fontSize: 24, marginLeft: 6 }}>L</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Albanian Lekë</div>
            <button className="btn" style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }} onClick={refreshBalance}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: 16, fontWeight: 700 }}>Payment Methods</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Apple Pay', desc: 'Fast & secure' },
                { icon: '💳', label: 'Card', desc: 'Visa, Mastercard, Amex' },
                { icon: '🏦', label: 'SEPA Direct Debit', desc: 'Bank transfer (IBAN)' },
              ].map(method => (
                <div key={method.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg3)', borderRadius: 10 }}>
                  <span style={{ fontSize: 24 }}>{method.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{method.label}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12 }}>{method.desc}</div>
                  </div>
                  <CheckCircle size={16} color="var(--accent3)" style={{ marginLeft: 'auto' }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ background: 'var(--accent)', borderRadius: 10, padding: 10 }}>
                <CreditCard size={20} color="#000" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18 }}>Top Up Wallet</h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>Choose an amount to add</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {TOPUP_AMOUNTS.map(amount => (
                <button
                  key={amount}
                  onClick={() => setSelectedAmount(amount)}
                  style={{
                    padding: '14px 16px',
                    border: selectedAmount === amount ? '2px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 10,
                    background: selectedAmount === amount ? 'rgba(232,184,75,0.1)' : 'var(--bg3)',
                    color: selectedAmount === amount ? 'var(--accent)' : 'var(--text)',
                    fontFamily: 'Syne',
                    fontSize: 18,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {amount} L
                </button>
              ))}
            </div>

            <button
              className="btn btn-primary"
              onClick={openPaymentModal}
              disabled={modalLoading}
              style={{ width: '100%', padding: '14px', fontSize: 16 }}
            >
              {modalLoading ? (
                <><RefreshCw size={16} className="spin" /> Loading...</>
              ) : (
                <><ArrowUpRight size={16} /> Pay {selectedAmount} L</>
              )}
            </button>
          </div>

          <div className="card" style={{ padding: 24, marginTop: 16 }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={16} /> Recent Transactions
            </h4>
            <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              No recent transactions
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  modalOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 10000,
    overflowY: 'auto',
    padding: '20px 0',
  },
  modalContent: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 480,
    margin: 'auto',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
  },
  paymentElementWrapper: {
    marginBottom: 20,
    padding: 20,
    background: 'var(--bg3)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    maxHeight: 300,
    overflowY: 'auto',
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid var(--red)',
    borderRadius: 8,
    padding: '12px 16px',
    color: 'var(--red)',
    fontSize: 14,
    marginBottom: 16,
  },
  modalFooter: {
    marginTop: 8,
  },
  payButton: {
    width: '100%',
    padding: '14px',
    fontSize: 16,
    fontWeight: 700,
  },
};
