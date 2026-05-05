// Row → API JSON shape helpers.

export function formatEvent(row) {
    return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        dateIso: row.date_iso,
        displayDay: row.display_day,
        displayMonth: row.display_month,
        displayDate: row.display_date,
        location: row.location,
        site: row.site,
        type: row.type,
        timeRange: row.time_range,
        checkIn: row.check_in,
        firstGame: row.first_game,
        endTime: row.end_time,
        basePriceCents: row.base_price_cents,
        basePriceDisplay: `$${(row.base_price_cents / 100).toFixed(0)}/head`,
        totalSlots: row.total_slots,
        coverImageUrl: row.cover_image_url,
        shortDescription: row.short_description,
        addons: safeJson(row.addons_json, []),
        gameModes: safeJson(row.game_modes_json, []),
        details: safeJson(row.details_json, null),
        customQuestions: safeJson(row.custom_questions_json, []),
        salesCloseAt: row.sales_close_at,
        past: !!row.past,
        featured: !!row.featured,
    };
}

export function formatTicketType(row) {
    const remaining = row.capacity != null ? Math.max(0, row.capacity - (row.sold || 0)) : null;
    return {
        id: row.id,
        eventId: row.event_id,
        name: row.name,
        description: row.description,
        priceCents: row.price_cents,
        priceDisplay: `$${(row.price_cents / 100).toFixed(2)}`,
        capacity: row.capacity,
        sold: row.sold || 0,
        remaining,
        soldOut: remaining === 0,
        minPerOrder: row.min_per_order,
        maxPerOrder: row.max_per_order,
        saleStartsAt: row.sale_starts_at,
        saleEndsAt: row.sale_ends_at,
        sortOrder: row.sort_order,
    };
}

export function formatBooking(row, { includeInternal = false } = {}) {
    const base = {
        id: row.id,
        eventId: row.event_id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        playerCount: row.player_count,
        subtotalCents: row.subtotal_cents,
        discountCents: row.discount_cents || 0,
        taxCents: row.tax_cents || 0,
        feeCents: row.fee_cents || 0,
        totalCents: row.total_cents,
        status: row.status,
        paymentMethod: row.payment_method || null,
        createdAt: row.created_at,
        paidAt: row.paid_at,
        lineItems: safeJson(row.line_items_json, []),
    };
    if (includeInternal) {
        base.stripeSessionId = row.stripe_session_id;
        base.stripePaymentIntent = row.stripe_payment_intent;
        base.notes = row.notes;
        base.pendingAttendees = safeJson(row.pending_attendees_json, []);
    }
    return base;
}

export function safeJson(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
