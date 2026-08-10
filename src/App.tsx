import { Component, useEffect, useState } from 'react';
import { calculateBill, reconcile } from './calculations';
import { demos } from './demos';
import { formatMoney, parseMoney } from './money';
import { IndexedDbBillRepository } from './storage';
import type { AdjustmentKind, Bill, PaymentStatus, Receipt } from './types';
const repo = new IndexedDbBillRepository();
const uid = () => crypto.randomUUID();
type Screen = 'home' | 'receipt' | 'people' | 'claim' | 'dashboard';
const blank = (): Receipt => ({
  restaurantName: '',
  items: [],
  adjustments: [],
  subtotal: 0,
  grandTotal: 0,
});
const moneyInput = (c: number, onChange: (n: number) => void) => (
  <input
    className="money"
    inputMode="decimal"
    value={(c / 100).toFixed(2)}
    onChange={(e) => {
      try {
        onChange(parseMoney(e.target.value));
      } catch {
        /* permit editing */
      }
    }}
  />
);
class BlobImage extends Component<{ blob: Blob; alt: string }> {
  private src = URL.createObjectURL(this.props.blob);
  componentDidUpdate(previous: Readonly<{ blob: Blob; alt: string }>) {
    if (previous.blob !== this.props.blob) {
      URL.revokeObjectURL(this.src);
      this.src = URL.createObjectURL(this.props.blob);
      this.forceUpdate();
    }
  }
  componentWillUnmount() {
    URL.revokeObjectURL(this.src);
  }
  render() {
    return <img src={this.src} alt={this.props.alt} />;
  }
}
export default function App() {
  const [screen, setScreen] = useState<Screen>('home'),
    [receipt, setReceipt] = useState<Receipt>(blank()),
    [bill, setBill] = useState<Bill>(),
    [saved, setSaved] = useState<Bill[]>([]),
    [override, setOverride] = useState(false);
  useEffect(() => {
    repo.list().then(setSaved);
  }, []);
  const result = bill ? calculateBill(bill) : undefined;
  const mutateReceipt = (fn: (r: Receipt) => void) =>
    setReceipt((old) => {
      const next = structuredClone(old);
      fn(next);
      next.subtotal = next.items.reduce((s, i) => s + i.lineTotal, 0);
      return next;
    });
  const startPeople = () => {
    const check = reconcile(receipt);
    if (!check.reconciled && !override) return;
    setBill({
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      creatorName: 'You',
      receipt,
      participants: [
        {
          id: uid(),
          displayName: 'You',
          isCreator: true,
          paymentStatus: 'UNPAID',
        },
      ],
      allocations: [],
      reconciliationOverride: override,
    });
    setScreen('people');
  };
  const save = (next: Bill) => {
    next = { ...next, updatedAt: new Date().toISOString() };
    setBill(next);
    void repo.save(next);
    void repo.list().then(setSaved);
  };
  const top = (
    <header>
      <button
        className="brand"
        onClick={() => setScreen('home')}
        aria-label="Home"
      >
        <span>🍽️</span> Makan Split
      </button>
      {screen !== 'home' && (
        <span className="step">
          {screen === 'receipt'
            ? 'Receipt'
            : screen === 'people'
              ? 'People'
              : screen === 'claim'
                ? 'Share'
                : 'Summary'}
        </span>
      )}
    </header>
  );
  if (screen === 'home')
    return (
      <>
        {top}
        <main className="home">
          <section className="hero">
            <p className="eyebrow">Fair shares, happy tables</p>
            <h1>
              Split dinner,
              <br />
              <em>not hairs.</em>
            </h1>
            <p>
              Turn a receipt into everyone’s exact share—including GST, service
              and that one shared dessert.
            </p>
            <button
              className="primary big"
              onClick={() => {
                setReceipt(blank());
                setScreen('receipt');
              }}
            >
              Split a bill <span>→</span>
            </button>
          </section>
          <section>
            <h2>Previous bills</h2>
            {saved.length ? (
              saved.map((b) => (
                <button
                  className="saved"
                  key={b.id}
                  onClick={() => {
                    setBill(b);
                    setReceipt(b.receipt);
                    setScreen('dashboard');
                  }}
                >
                  <span>
                    <b>{b.receipt.restaurantName}</b>
                    <small>
                      {new Date(b.createdAt).toLocaleDateString('en-SG')} ·{' '}
                      {b.participants.length} people
                    </small>
                  </span>
                  <strong>{formatMoney(b.receipt.grandTotal)}</strong>
                </button>
              ))
            ) : (
              <div className="empty">
                <span>🧾</span>
                <p>Your recent splits will stay safely on this device.</p>
              </div>
            )}
          </section>
        </main>
      </>
    );
  if (screen === 'receipt') {
    const check = reconcile(receipt);
    return (
      <>
        {top}
        <main>
          <div className="heading">
            <button className="back" onClick={() => setScreen('home')}>
              ← Back
            </button>
            <p className="eyebrow">Step 1 of 3</p>
            <h1>Add your receipt</h1>
            <p>Snap it, choose a photo, or start with a demo.</p>
          </div>
          <section className="card upload">
            {receipt.image ? (
              <>
                <BlobImage blob={receipt.image} alt="Receipt preview" />
                <div>
                  <label className="secondary">
                    Replace
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          mutateReceipt((r) => {
                            r.image = f;
                          });
                      }}
                    />
                  </label>
                  <button
                    className="ghost"
                    onClick={() =>
                      mutateReceipt((r) => {
                        delete r.image;
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <label>
                <span>📷</span>
                <b>Photograph or upload receipt</b>
                <small>JPEG, PNG or HEIC from your device</small>
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      mutateReceipt((r) => {
                        r.image = f;
                      });
                  }}
                />
              </label>
            )}
          </section>
          <div className="demo-row">
            <span>Or load a demo</span>
            {demos.map((d, i) => (
              <button
                key={d.restaurantName}
                onClick={() => setReceipt(structuredClone(d))}
              >
                {String.fromCharCode(65 + i)}
              </button>
            ))}
          </div>
          {(receipt.items.length > 0 || receipt.restaurantName) && (
            <section className="card review">
              <div className="section-title">
                <div>
                  <p className="eyebrow">Review details</p>
                  <h2>What’s on the bill?</h2>
                </div>
                <span className="tag">Editable</span>
              </div>
              <label>
                Restaurant
                <input
                  value={receipt.restaurantName}
                  placeholder="Restaurant name"
                  onChange={(e) =>
                    mutateReceipt((r) => {
                      r.restaurantName = e.target.value;
                    })
                  }
                />
              </label>
              <div className="items">
                {receipt.items.map((item, index) => (
                  <div className="item-edit" key={item.id}>
                    <label className="qty">
                      Qty
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) =>
                          mutateReceipt((r) => {
                            const x = r.items[index];
                            x.quantity = Number(e.target.value);
                            x.lineTotal = x.quantity * x.unitPrice;
                          })
                        }
                      />
                    </label>
                    <label className="name">
                      Item
                      <input
                        value={item.name}
                        onChange={(e) =>
                          mutateReceipt((r) => {
                            r.items[index].name = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      Unit price
                      {moneyInput(item.unitPrice, (n) =>
                        mutateReceipt((r) => {
                          const x = r.items[index];
                          x.unitPrice = n;
                          x.lineTotal = x.quantity * n;
                        }),
                      )}
                    </label>
                    <button
                      className="remove"
                      aria-label={'Remove ' + item.name}
                      onClick={() =>
                        mutateReceipt((r) => {
                          r.items.splice(index, 1);
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="secondary full"
                  onClick={() =>
                    mutateReceipt((r) => {
                      r.items.push({
                        id: uid(),
                        name: 'New item',
                        quantity: 1,
                        unitPrice: 0,
                        lineTotal: 0,
                      });
                    })
                  }
                >
                  ＋ Add item
                </button>
              </div>
              <h3>Receipt totals</h3>
              <div className="totals">
                <div>
                  <span>Items subtotal</span>
                  <b>{formatMoney(receipt.subtotal)}</b>
                </div>
                {receipt.adjustments.map((a, index) => (
                  <div key={a.id} className="adjust">
                    <input
                      aria-label="Adjustment label"
                      value={a.label}
                      onChange={(e) =>
                        mutateReceipt((r) => {
                          r.adjustments[index].label = e.target.value;
                        })
                      }
                    />
                    <select
                      aria-label="Adjustment type"
                      value={a.kind}
                      onChange={(e) =>
                        mutateReceipt((r) => {
                          r.adjustments[index].kind = e.target
                            .value as AdjustmentKind;
                        })
                      }
                    >
                      <option value="SERVICE">Service</option>
                      <option value="TAX">Tax / GST</option>
                      <option value="DISCOUNT">Discount</option>
                      <option value="OTHER">Other</option>
                    </select>
                    {moneyInput(a.amount, (n) =>
                      mutateReceipt((r) => {
                        r.adjustments[index].amount = n;
                      }),
                    )}
                    <button
                      className="remove"
                      onClick={() =>
                        mutateReceipt((r) => {
                          r.adjustments.splice(index, 1);
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="link"
                  onClick={() =>
                    mutateReceipt((r) => {
                      r.adjustments.push({
                        id: uid(),
                        label: 'Adjustment',
                        kind: 'OTHER',
                        amount: 0,
                      });
                    })
                  }
                >
                  ＋ Add charge, discount or rounding
                </button>
                <label className="grand">
                  Receipt total
                  {moneyInput(receipt.grandTotal, (n) =>
                    mutateReceipt((r) => {
                      r.grandTotal = n;
                    }),
                  )}
                </label>
              </div>
              <div className={'reconcile ' + (check.reconciled ? 'ok' : 'bad')}>
                <span>{check.reconciled ? '✓' : '!'}</span>
                <div>
                  <b>
                    {check.reconciled
                      ? 'Receipt reconciled'
                      : "Receipt doesn't balance"}
                  </b>
                  {!check.reconciled && (
                    <small>
                      Calculated {formatMoney(check.calculated)} · Receipt{' '}
                      {formatMoney(receipt.grandTotal)} · Difference{' '}
                      {formatMoney(Math.abs(check.difference))}
                    </small>
                  )}
                </div>
              </div>
              {!check.reconciled && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />{' '}
                  I checked this unusual receipt and want to continue
                </label>
              )}
              <button
                className="primary full"
                disabled={!check.reconciled && !override}
                onClick={startPeople}
              >
                Add people <span>→</span>
              </button>
            </section>
          )}
        </main>
      </>
    );
  }
  if (!bill) return null;
  if (screen === 'people')
    return (
      <>
        {top}
        <main>
          <div className="heading">
            <button className="back" onClick={() => setScreen('receipt')}>
              ← Back
            </button>
            <p className="eyebrow">Step 2 of 3</p>
            <h1>Who was at the table?</h1>
            <p>
              Add everyone who’ll claim items. No account or contact details
              needed.
            </p>
          </div>
          <section className="card">
            <div className="people">
              {bill.participants.map((p, i) => (
                <div key={p.id}>
                  <span className="avatar">
                    {p.displayName[0]?.toUpperCase()}
                  </span>
                  <input
                    value={p.displayName}
                    aria-label="Participant name"
                    onChange={(e) => {
                      const n = structuredClone(bill);
                      n.participants[i].displayName = e.target.value;
                      save(n);
                    }}
                  />
                  {p.isCreator ? (
                    <span className="tag">Creator</span>
                  ) : (
                    <button
                      className="remove"
                      onClick={() => {
                        const n = structuredClone(bill);
                        n.participants.splice(i, 1);
                        save(n);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              className="secondary full"
              onClick={() =>
                save({
                  ...bill,
                  participants: [
                    ...bill.participants,
                    {
                      id: uid(),
                      displayName: `Friend ${bill.participants.length}`,
                      paymentStatus: 'UNPAID',
                    },
                  ],
                })
              }
            >
              ＋ Add person
            </button>
          </section>
          <button
            className="primary full outside"
            onClick={() => setScreen('claim')}
          >
            Share the dishes <span>→</span>
          </button>
        </main>
      </>
    );
  if (screen === 'claim')
    return (
      <>
        {top}
        <main>
          <div className="heading">
            <button className="back" onClick={() => setScreen('people')}>
              ← People
            </button>
            <p className="eyebrow">Step 3 of 3</p>
            <h1>Who had what?</h1>
            <p>
              Tap names to split a dish equally. Every cent is assigned
              consistently.
            </p>
          </div>
          <div className="claim-list">
            {bill.receipt.items.map((item) => {
              const active =
                bill.allocations.find((a) => a.itemId === item.id)
                  ?.participantIds ?? [];
              return (
                <section className="card claim" key={item.id}>
                  <div>
                    <div>
                      <h2>
                        {item.quantity > 1 && <small>{item.quantity}×</small>}{' '}
                        {item.name}
                      </h2>
                      <span>
                        {active.length
                          ? `Split ${active.length} way${active.length > 1 ? 's' : ''}`
                          : 'Not claimed yet'}
                      </span>
                    </div>
                    <strong>{formatMoney(item.lineTotal)}</strong>
                  </div>
                  <div className="chips">
                    {bill.participants.map((p) => (
                      <button
                        aria-pressed={active.includes(p.id)}
                        className={active.includes(p.id) ? 'active' : ''}
                        key={p.id}
                        onClick={() => {
                          const n = structuredClone(bill);
                          let a = n.allocations.find(
                            (x) => x.itemId === item.id,
                          );
                          if (!a) {
                            a = { itemId: item.id, participantIds: [] };
                            n.allocations.push(a);
                          }
                          a.participantIds = a.participantIds.includes(p.id)
                            ? a.participantIds.filter((id) => id !== p.id)
                            : [...a.participantIds, p.id];
                          save(n);
                        }}
                      >
                        <span>
                          {active.includes(p.id) ? '✓' : p.displayName[0]}
                        </span>
                        {p.displayName}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <button
            className="primary full outside"
            onClick={() => {
              save(bill);
              setScreen('dashboard');
            }}
          >
            See everyone’s share <span>→</span>
          </button>
        </main>
      </>
    );
  const statusLabel: Record<PaymentStatus, string> = {
    UNPAID: 'Unpaid',
    MARKED_SENT: 'Sent',
    CONFIRMED_RECEIVED: 'Confirmed',
  };
  const marked = bill.participants.reduce(
      (s, p) =>
        s +
        (p.paymentStatus === 'MARKED_SENT'
          ? (result?.breakdowns.find((x) => x.participantId === p.id)?.total ??
            0)
          : 0),
      0,
    ),
    confirmed = bill.participants.reduce(
      (s, p) =>
        s +
        (p.paymentStatus === 'CONFIRMED_RECEIVED'
          ? (result?.breakdowns.find((x) => x.participantId === p.id)?.total ??
            0)
          : 0),
      0,
    );
  return (
    <>
      {top}
      <main>
        <div className="heading dashboard-head">
          <button className="back" onClick={() => setScreen('claim')}>
            ← Edit claims
          </button>
          <p className="eyebrow">{bill.receipt.restaurantName}</p>
          <h1>All squared up?</h1>
          <p>Payment claims and confirmations stay separate.</p>
        </div>
        <section className="summary">
          <div>
            <span>Bill total</span>
            <strong>{formatMoney(bill.receipt.grandTotal)}</strong>
          </div>
          <div>
            <span>Allocated</span>
            <b>{formatMoney(result!.allocated)}</b>
          </div>
          <div>
            <span>Unclaimed</span>
            <b>{formatMoney(result!.unclaimed)}</b>
          </div>
          <div>
            <span>Marked sent</span>
            <b>{formatMoney(marked)}</b>
          </div>
          <div>
            <span>Confirmed</span>
            <b>{formatMoney(confirmed)}</b>
          </div>
          <div>
            <span>Outstanding</span>
            <b>{formatMoney(bill.receipt.grandTotal - confirmed)}</b>
          </div>
        </section>
        <section>
          <div className="section-title">
            <div>
              <p className="eyebrow">Breakdown</p>
              <h2>Everyone’s share</h2>
            </div>
          </div>
          {bill.participants.map((p, index) => {
            const b = result!.breakdowns.find((x) => x.participantId === p.id)!;
            return (
              <details className="person-total" key={p.id}>
                <summary>
                  <span className="avatar">{p.displayName[0]}</span>
                  <span>
                    <b>{p.displayName}</b>
                    <small className={'status ' + p.paymentStatus}>
                      {statusLabel[p.paymentStatus]}
                    </small>
                  </span>
                  <strong>{formatMoney(b.total)}</strong>
                </summary>
                <div className="breakdown">
                  <div>
                    <span>Items</span>
                    <b>{formatMoney(b.itemSubtotal)}</b>
                  </div>
                  <div>
                    <span>Service charge</span>
                    <b>{formatMoney(b.service)}</b>
                  </div>
                  <div>
                    <span>GST / tax</span>
                    <b>{formatMoney(b.tax)}</b>
                  </div>
                  <div>
                    <span>Discounts & adjustments</span>
                    <b>{formatMoney(b.discount + b.other)}</b>
                  </div>
                  <div className="owe">
                    <span>You owe {bill.creatorName}</span>
                    <b>{formatMoney(b.total)}</b>
                  </div>
                  {bill.payNowQr && (
                    <BlobImage blob={bill.payNowQr} alt="Creator's PayNow QR" />
                  )}
                  <p className="note">
                    Check and enter the exact amount in your banking app. This
                    app does not process or verify payments.
                  </p>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => {
                        const n = structuredClone(bill);
                        n.participants[index].paymentStatus =
                          p.paymentStatus === 'MARKED_SENT'
                            ? 'UNPAID'
                            : 'MARKED_SENT';
                        save(n);
                      }}
                    >
                      {p.paymentStatus === 'MARKED_SENT'
                        ? 'Undo sent'
                        : 'Mark payment as sent'}
                    </button>
                    <button
                      className="primary"
                      onClick={() => {
                        const n = structuredClone(bill);
                        n.participants[index].paymentStatus =
                          p.paymentStatus === 'CONFIRMED_RECEIVED'
                            ? 'UNPAID'
                            : 'CONFIRMED_RECEIVED';
                        save(n);
                      }}
                    >
                      {p.paymentStatus === 'CONFIRMED_RECEIVED'
                        ? 'Undo confirmation'
                        : 'Confirm received'}
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </section>
        <section className="card paynow">
          <h2>PayNow QR</h2>
          <p>Optional. Stored only on this device in this prototype.</p>
          <label className="secondary">
            {bill.payNowQr ? 'Replace QR' : 'Upload creator’s QR'}
            <input
              hidden
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) save({ ...bill, payNowQr: f });
              }}
            />
          </label>
        </section>
      </main>
    </>
  );
}
