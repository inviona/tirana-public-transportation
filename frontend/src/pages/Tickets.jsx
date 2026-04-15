import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { Ticket, Plus, Wallet, QrCode, X, CreditCard } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

const TOPUP_AMOUNTS = [200, 500, 1000, 2000, 5000];

const TICKET_TYPES = [
  { id: 'single', label: 'Single Ride', price: 40, desc: 'Valid for 4 hours on any single route', icon: '🎫' },
  { id: 'daily', label: 'Day Pass', price: 150, desc: 'Unlimited rides for 24 hours', icon: '☀️' },
  { id: 'weekly', label: 'Weekly Pass', price: 600, desc: 'Unlimited rides for 7 days', icon: '📅' },
  { id: 'monthly', label: 'Monthly Pass', price: 2500, desc: 'Unlimited rides for 30 days — best value', icon: '🏷️' },
];

function PaymentForm({ amount, onClose, onSuccess }) {
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
      const confirmRes = await fetch('http://localhost:3001/api/payments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
      });
      const confirmData = await confirmRes.json();
      if (confirmData.success) {
        onSuccess(confirmData.balance);
      } else {
        setError(confirmData.error || 'Payment succeeded but balance update failed');
      }
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <div style={{ marginTop: 20, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        Supported: <CreditCard size={14} style={{ marginLeft: 4 }} /> Card, Apple Pay, Google Pay, SEPA Direct Debit (IBAN)
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 14, marginTop: 12 }}>{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={loading || !stripe} style={{ width: '100%', marginTop: 16 }}>
        {loading ? 'Processing...' : `Pay ${amount} L`}
      </button>
    </form>
  );
}

function PaymentModal({ amount, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initPayment = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/payments/create-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({ amount }),
        });
        const data = await res.json();
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setError(data.error || 'Failed to initialize payment');
        }
      } catch (err) {
        setError('Failed to connect to payment server');
      } finally {
        setLoading(false);
      }
    };
    initPayment();
  }, [amount]);

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
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h3 style={{ margin: 0 }}>Top Up Wallet — {amount} L</h3>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ color: 'var(--muted)', marginBottom: 12 }}>Initializing payment...</div>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <p style={{ color: 'var(--red)', marginBottom: 16 }}>{error}</p>
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <PaymentForm amount={amount} onClose={onClose} onSuccess={onSuccess} />
          </Elements>
        )}
      </div>
    </div>
  );
}

export default function Tickets() {
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [balance, setBalance] = useState(user?.balance || 0);
  const [tab, setTab] = useState('my');
  const [purchasing, setPurchasing] = useState(null);
  const [topupAmount, setTopupAmount] = useState(500);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const fetchTickets = () => {
    fetch('http://localhost:3001/api/tickets', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setTickets);
  };

  const refreshBalance = async () => {
    const res = await fetch('http://localhost:3001/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userData = await res.json();
    if (userData.balance !== undefined) {
      setBalance(userData.balance);
    }
  };

  useEffect(() => { fetchTickets(); refreshBalance(); }, []);

  const handleTopup = async () => {
    setShowPaymentModal(true);
  };

  const handlePaymentSuccess = (newBalance) => {
    setBalance(newBalance);
    setShowPaymentModal(false);
    showToast(`✅ Topped up ${topupAmount} L successfully!`);
  };

  const handleBuy = async (type) => {
    if (balance < type.price) { showToast('❌ Insufficient balance. Please top up your wallet.'); return; }
    setLoading(true);
    const res = await fetch('http://localhost:3001/api/tickets/purchase', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: type.id })
    });
    const data = await res.json();
    if (data.error) { showToast(`❌ ${data.error}`); }
    else {
      setBalance(data.newBalance);
      fetchTickets();
      showToast(`✅ ${type.label} purchased successfully!`);
      setTab('my');
    }
    setLoading(false);
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      {showPaymentModal && (
        <PaymentModal
          amount={topupAmount}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', top: 24, right: 24, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px', zIndex: 9999, fontWeight: 600, fontSize: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          {toast}
        </div>
      )}

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Tickets & Wallet</h1>
        <p style={{ color: 'var(--muted)' }}>Manage your transit tickets and account balance.</p>
      </div>

      <div style={{ background: 'linear-gradient(135deg, #1a2a4a 0%, #0e1528 100%)', border: '1px solid rgba(232,184,75,0.2)', borderRadius: 20, padding: '28px 32px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8, fontWeight: 500 }}>WALLET BALANCE</div>
          <div style={{ fontFamily: 'Syne', fontSize: 42, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{balance.toLocaleString()}<span style={{ fontSize: 20, marginLeft: 6 }}>L</span></div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Albanian Lekë</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={topupAmount} onChange={e => setTopupAmount(Number(e.target.value))} style={{ width: 120 }}>
              {TOPUP_AMOUNTS.map(a => <option key={a} value={a}>{a} L</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleTopup} disabled={loading}>
              <Wallet size={13} /> Top Up
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)' }}>Add funds via Card, Apple Pay, or SEPA</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 4, borderRadius: 12, marginBottom: 24, width: 'fit-content' }}>
        {[{ id: 'my', label: 'My Tickets' }, { id: 'buy', label: 'Buy Tickets' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="btn" style={{
            padding: '8px 20px', background: tab === t.id ? 'var(--accent)' : 'transparent',
            color: tab === t.id ? '#000' : 'var(--muted)', fontSize: 13
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'my' ? (
        <div>
          {tickets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
              <Ticket size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
              <p>No tickets yet. Purchase a ticket to get started.</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setTab('buy')}>
                <Plus size={15} /> Buy Your First Ticket
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {tickets.map(t => (
                <div key={t.id} className="card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: t.status === 'active' ? 'var(--accent3)' : t.status === 'used' ? 'var(--muted)' : 'var(--red)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, marginBottom: 4, textTransform: 'capitalize' }}>{t.type} Ticket</div>
                      {t.route && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Route {t.route.number} — {t.route.name}</div>}
                    </div>
                    <span className={`badge ${t.status === 'active' ? 'badge-green' : t.status === 'used' ? 'badge-blue' : 'badge-red'}`}>{t.status}</span>
                  </div>

                  {t.status === 'active' && t.qrCode && (
                    <div style={{ background: 'white', padding: 12, borderRadius: 10, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ background: '#000', width: 48, height: 48, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <QrCode size={28} color="#fff" />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: '#666', marginBottom: 2 }}>QR CODE</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#000', fontWeight: 700 }}>{t.qrCode}</div>
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Purchased</span>
                      <span>{formatDate(t.purchasedAt)}</span>
                    </div>
                    {t.expiresAt && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Expires</span>
                        <span style={{ color: t.status === 'active' ? 'var(--accent)' : 'inherit' }}>{formatDate(t.expiresAt)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 600 }}>
                      <span>Paid</span>
                      <span style={{ color: 'var(--text)' }}>{t.price} L</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {TICKET_TYPES.map(type => (
            <div key={type.id} className="card" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{type.icon}</div>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{type.label}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>{type.desc}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 28, color: 'var(--accent)' }}>
                  {type.price} <span style={{ fontSize: 14 }}>L</span>
                </div>
                <button className="btn btn-primary" onClick={() => handleBuy(type)} disabled={loading}>
                  <Plus size={14} /> Buy Now
                </button>
              </div>
              {balance < type.price && (
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--red)' }}>⚠ Insufficient balance — top up your wallet</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 10000,
  },
  modal: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16,
    padding: 28, width: '100%', maxWidth: 480,
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 24,
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
    padding: 4, display: 'flex', alignItems: 'center',
  },
};
