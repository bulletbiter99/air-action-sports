// Server-side pricing calculator — the only source of truth for totals.
// Never trust client-sent prices. We re-compute from event/ticket_type/addon DB data.

/**
 * @param {object} args
 * @param {{basePriceCents:number, addons:Array}} args.event
 * @param {Array<{id:string, priceCents:number, maxPerOrder:number|null, minPerOrder:number, remaining:number|null}>} args.ticketTypes
 * @param {Array<{ticketTypeId:string, qty:number}>} args.ticketSelections
 * @param {Array<{sku:string, qty:number}>} args.addonSelections
 * @param {{id?:string, discountType:'percent'|'fixed', discountValue:number}|null} [args.promo]
 * @param {Array<object>} [args.taxesFees] - active rows from taxes_fees table
 * @returns {object}
 */
export function calculateQuote({ event, ticketTypes, ticketSelections, addonSelections, promo = null, taxesFees = [] }) {
    const errors = [];
    const lineItems = [];

    const ticketTypesById = new Map(ticketTypes.map((t) => [t.id, t]));
    const addonsBySku = new Map((event.addons || []).map((a) => [a.sku, a]));

    // Tickets
    let ticketsSubtotal = 0;
    let totalAttendees = 0;
    for (const sel of ticketSelections) {
        if (!sel.qty || sel.qty <= 0) continue;
        const tt = ticketTypesById.get(sel.ticketTypeId);
        if (!tt) {
            errors.push(`Unknown ticket type: ${sel.ticketTypeId}`);
            continue;
        }
        if (tt.minPerOrder && sel.qty < tt.minPerOrder) {
            errors.push(`${tt.name}: minimum ${tt.minPerOrder} per order`);
        }
        if (tt.maxPerOrder && sel.qty > tt.maxPerOrder) {
            errors.push(`${tt.name}: maximum ${tt.maxPerOrder} per order`);
        }
        if (tt.remaining != null && sel.qty > tt.remaining) {
            errors.push(`${tt.name}: only ${tt.remaining} remaining`);
        }
        ticketsSubtotal += tt.priceCents * sel.qty;
        totalAttendees += sel.qty;
        lineItems.push({
            type: 'ticket',
            ticket_type_id: tt.id,
            name: tt.name,
            qty: sel.qty,
            unit_price_cents: tt.priceCents,
            line_total_cents: tt.priceCents * sel.qty,
        });
    }

    if (totalAttendees === 0) {
        errors.push('At least one ticket is required');
    }

    // Add-ons
    let addonsSubtotal = 0;
    for (const sel of addonSelections) {
        if (!sel.qty || sel.qty <= 0) continue;
        const addon = addonsBySku.get(sel.sku);
        if (!addon) {
            errors.push(`Unknown add-on: ${sel.sku}`);
            continue;
        }
        if (addon.max_per_order != null && sel.qty > addon.max_per_order) {
            errors.push(`${addon.name}: max ${addon.max_per_order} per order`);
        }
        addonsSubtotal += addon.price_cents * sel.qty;
        lineItems.push({
            type: 'addon',
            sku: addon.sku,
            name: addon.name,
            addon_type: addon.type || 'consumable',
            qty: sel.qty,
            unit_price_cents: addon.price_cents,
            line_total_cents: addon.price_cents * sel.qty,
        });
    }

    const subtotalCents = ticketsSubtotal + addonsSubtotal;

    // Promo code
    let discountCents = 0;
    if (promo && subtotalCents > 0) {
        if (promo.discountType === 'percent') {
            discountCents = Math.floor((subtotalCents * promo.discountValue) / 100);
        } else if (promo.discountType === 'fixed') {
            discountCents = Math.min(promo.discountValue, subtotalCents);
        }
    }
    const afterDiscount = subtotalCents - discountCents;

    // Taxes & Fees from global config. Apply taxes first, then fees (fees can ride on top of taxes).
    const activeTaxes = taxesFees.filter((tf) => tf.active && tf.category === 'tax')
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const activeFees = taxesFees.filter((tf) => tf.active && tf.category === 'fee')
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const unitMultiplier = (per_unit) =>
        per_unit === 'ticket' || per_unit === 'attendee' ? totalAttendees : 1;

    let taxCents = 0;
    for (const t of activeTaxes) {
        const percentBase =
            t.applies_to === 'tickets' ? Math.max(0, ticketsSubtotal - discountCents * (subtotalCents ? ticketsSubtotal / subtotalCents : 0)) :
            t.applies_to === 'addons'  ? Math.max(0, addonsSubtotal - discountCents * (subtotalCents ? addonsSubtotal / subtotalCents : 0)) :
            afterDiscount;
        const percentAmt = Math.floor((percentBase * (t.percent_bps || 0)) / 10000);
        const fixedAmt = (t.fixed_cents || 0) * unitMultiplier(t.per_unit);
        const amt = percentAmt + fixedAmt;
        if (amt > 0) {
            lineItems.push({
                type: 'tax',
                tax_fee_id: t.id,
                name: t.name,
                line_total_cents: amt,
                percent_bps: t.percent_bps || 0,
                fixed_cents: t.fixed_cents || 0,
            });
            taxCents += amt;
        }
    }

    let feeCents = 0;
    for (const f of activeFees) {
        const percentBase =
            f.applies_to === 'tickets' ? ticketsSubtotal :
            f.applies_to === 'addons'  ? addonsSubtotal :
            afterDiscount + taxCents;  // fees on gross including taxes
        const percentAmt = Math.floor((percentBase * (f.percent_bps || 0)) / 10000);
        const fixedAmt = (f.fixed_cents || 0) * unitMultiplier(f.per_unit);
        const amt = percentAmt + fixedAmt;
        if (amt > 0) {
            lineItems.push({
                type: 'fee',
                tax_fee_id: f.id,
                name: f.name,
                line_total_cents: amt,
                percent_bps: f.percent_bps || 0,
                fixed_cents: f.fixed_cents || 0,
            });
            feeCents += amt;
        }
    }

    const totalCents = afterDiscount + taxCents + feeCents;

    return {
        lineItems,
        subtotalCents,
        discountCents,
        taxCents,
        feeCents,
        totalCents,
        totalAttendees,
        errors,
    };
}

export async function loadActiveTaxesFees(db) {
    const result = await db.prepare(
        `SELECT * FROM taxes_fees WHERE active = 1 ORDER BY category, sort_order ASC`
    ).all();
    return result.results || [];
}

export function centsToDollars(cents) {
    return (cents / 100).toFixed(2);
}
