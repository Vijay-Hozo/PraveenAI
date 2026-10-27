(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  // Outside Telegram (or if telegram-web-app.js failed to load) the app still renders as a plain page.
  const inTelegram = Boolean(tg && tg.platform !== "unknown");
  // Keyboard-button launches and plain browsers have no initData, so the API can't be used.
  // In that case searches are sent to the chat with sendData() and the bot replies there.
  const canUseApi = Boolean(tg?.initData);
  const supports = (version) => inTelegram && tg.isVersionAtLeast(version);

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    tab: "flights",
    view: "flights-form",
    busy: false,
    config: { hotelBookingEnabled: false },
    flights: [],
    selectedFlight: null,
    hotels: [],
    selectedHotel: null,
    prebook: null,
    food: { area: "", restaurants: [], restaurant: null, menu: [], cart: new Map(), order: null, poll: null },
  };

  // ---------- Telegram helpers ----------

  const haptic = {
    impact: (style = "light") => supports("6.1") && tg.HapticFeedback.impactOccurred(style),
    notify: (type) => supports("6.1") && tg.HapticFeedback.notificationOccurred(type),
    select: () => supports("6.1") && tg.HapticFeedback.selectionChanged(),
  };

  function showAlert(message) {
    return new Promise((resolve) => {
      if (supports("6.2")) tg.showAlert(message, resolve);
      else { window.alert(message); resolve(); }
    });
  }

  function showConfirm(message) {
    return new Promise((resolve) => {
      if (supports("6.2")) tg.showConfirm(message, resolve);
      else resolve(window.confirm(message));
    });
  }

  // CloudStorage syncs per user across Telegram devices; localStorage is the browser fallback.
  const storage = {
    get(key) {
      return new Promise((resolve) => {
        if (supports("6.9")) {
          tg.CloudStorage.getItem(key, (error, value) => resolve(error ? null : value || null));
          return;
        }
        try { resolve(localStorage.getItem(key)); } catch { resolve(null); }
      });
    },
    set(key, value) {
      return new Promise((resolve) => {
        if (supports("6.9")) { tg.CloudStorage.setItem(key, value, () => resolve()); return; }
        try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
        resolve();
      });
    },
    remove(keys) {
      return new Promise((resolve) => {
        if (supports("6.9")) { tg.CloudStorage.removeItems(keys, () => resolve()); return; }
        try { keys.forEach((key) => localStorage.removeItem(key)); } catch { /* storage unavailable */ }
        resolve();
      });
    },
  };

  async function getJson(key, fallback) {
    try { return JSON.parse(await storage.get(key)) ?? fallback; } catch { return fallback; }
  }

  // ---------- Bottom buttons ----------

  let mainHandler = null;
  let secondaryHandler = null;
  const fallbackMain = $("#fallback-main");
  const fallbackSecondary = $("#fallback-secondary");

  function syncFallbackContainer() {
    $("#fallback-buttons").hidden = inTelegram || (fallbackMain.hidden && fallbackSecondary.hidden);
  }

  function setMain(options) {
    mainHandler = options?.onClick ?? null;
    if (inTelegram) {
      tg.MainButton.hideProgress();
      if (!options) tg.MainButton.hide();
      else tg.MainButton.setParams({
        text: options.text,
        is_visible: true,
        is_active: options.enabled !== false,
        has_shine_effect: Boolean(options.shine),
      });
    } else {
      fallbackMain.hidden = !options;
      fallbackMain.textContent = options?.text ?? "";
      fallbackMain.disabled = options?.enabled === false;
    }
    syncFallbackContainer();
  }

  function setMainProgress(loading) {
    if (inTelegram) {
      if (loading) tg.MainButton.showProgress(false);
      else tg.MainButton.hideProgress();
    } else {
      fallbackMain.disabled = loading;
    }
  }

  function setSecondary(options) {
    secondaryHandler = options?.onClick ?? null;
    if (supports("7.10")) {
      if (!options) tg.SecondaryButton.hide();
      else tg.SecondaryButton.setParams({ text: options.text, is_visible: true, position: "left" });
    } else if (!inTelegram) {
      fallbackSecondary.hidden = !options;
      fallbackSecondary.textContent = options?.text ?? "";
    }
    syncFallbackContainer();
  }

  // ---------- API ----------

  async function api(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `tma ${tg.initData}` },
      body: JSON.stringify(body ?? {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  // Runs one action at a time and reports failures with a native popup.
  async function run(action, onError) {
    if (state.busy) return;
    state.busy = true;
    try {
      await action();
    } catch (error) {
      haptic.notify("error");
      onError?.();
      await showAlert(error.message || "Something went wrong.");
    } finally {
      state.busy = false;
      setMainProgress(false);
      setLoading(false);
    }
  }

  // ---------- Formatting ----------

  function isoDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00`);
    date.setDate(date.getDate() + days);
    return isoDate(date);
  }

  // "DXB 2026-12-20T10:05:00" -> "DXB 10:05, 20 Dec"
  function formatFlightTime(value) {
    const match = value.match(/^(?:(\w{3})\s+)?(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return value;
    const [, airport, , month, day, hour, minute] = match;
    const monthName = new Date(2000, Number(month) - 1, 1).toLocaleString("en", { month: "short" });
    return `${airport ? `${airport} ` : ""}${hour}:${minute}, ${Number(day)} ${monthName}`;
  }

  // ISO 8601 duration "PT3H20M" / "P1DT2H" -> "3h 20m" / "26h"
  function formatDuration(value) {
    const match = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return "";
    const hours = Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0);
    const minutes = Number(match[3] ?? 0);
    return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ");
  }

  function plural(count, unit) {
    return `${count} ${unit}${count === 1 ? "" : "s"}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setLoading(loading, text = "Searching…") {
    $("#loading").hidden = !loading;
    $("#loading-text").textContent = text;
  }

  // ---------- Views ----------

  const backTargets = {
    "flight-results": "flights-form",
    "hotel-results": "hotels-form",
    guest: "hotel-results",
    booked: "hotels-form",
    "food-results": "food-form",
    "food-menu": "food-results",
    "food-checkout": "food-menu",
    "food-ordered": "food-form",
  };

  const views = {
    "flights-form": () => {
      setMain({ text: canUseApi ? "Search flights" : "Send search to chat", onClick: submitFlightSearch });
      setSecondary(null);
    },
    "hotels-form": () => {
      setMain({ text: canUseApi ? "Search hotels" : "Send search to chat", onClick: submitHotelSearch });
      setSecondary(null);
    },
    "flight-results": () => {
      const offer = state.selectedFlight;
      setMain(offer && { text: `Select · ${offer.totalCurrency} ${offer.totalAmount}`, onClick: selectFlight, shine: true });
      setSecondary(offer && supports("8.0") && { text: "Share", onClick: () => share({ type: "flight", offerId: offer.id }) });
    },
    "hotel-results": () => {
      const offer = state.selectedHotel;
      setMain(offer && { text: `Continue · ${offer.totalCurrency} ${offer.totalAmount.toFixed(2)}`, onClick: prebookSelectedHotel });
      setSecondary(offer && supports("8.0") && { text: "Share", onClick: () => share({ type: "hotel", key: offer.key }) });
    },
    guest: () => {
      const { prebook } = state;
      setMain(state.config.hotelBookingEnabled
        ? { text: `Book · ${prebook.currency} ${prebook.price.toFixed(2)}`, onClick: bookHotel, shine: true }
        : { text: "Booking needs a LiteAPI sandbox key", enabled: false });
      setSecondary(null);
    },
    "food-form": () => {
      setMain(canUseApi
        ? { text: "Find restaurants", onClick: submitFoodSearch }
        : { text: "Open from the menu button to order food", enabled: false });
      setSecondary(null);
    },
    "food-results": () => {
      setMain(null);
      setSecondary(null);
    },
    "food-menu": () => {
      const { restaurant } = state.food;
      const { count, subtotal } = cartTotals();
      if (!count) setMain(null);
      else if (subtotal < restaurant.minimumOrder) {
        setMain({ text: `Add ${money(restaurant.minimumOrder - subtotal)} more to order`, enabled: false });
      } else {
        setMain({ text: `View cart · ${plural(count, "item")} · ${money(subtotal)}`, onClick: openCheckout });
      }
      setSecondary(count ? { text: "Clear cart", onClick: clearCart } : null);
    },
    "food-checkout": () => {
      setMain({ text: `Place order · ${money(cartTotals().total)}`, onClick: placeFoodOrder, shine: true });
      setSecondary(null);
    },
    "food-ordered": () => {
      setMain({ text: "Done", onClick: () => (inTelegram ? tg.close() : show("food-form")) });
      setSecondary(null);
    },
    booked: () => {
      setMain({ text: "Done", onClick: () => tg.close() });
      setSecondary(supports("8.0") && state.selectedHotel && {
        text: "Share hotel",
        onClick: () => share({ type: "hotel", key: state.selectedHotel.key }),
      });
    },
  };

  function show(view) {
    state.view = view;
    for (const section of $$(".view")) section.hidden = section.dataset.view !== view;

    const isForm = view.endsWith("-form");
    $("#tabs").hidden = !isForm;
    $("#quick-notice").hidden = !isForm || canUseApi;

    if (supports("6.1")) {
      if (isForm) tg.BackButton.hide();
      else tg.BackButton.show();
    }
    if (view !== "food-ordered") stopOrderPolling();

    // Ask before closing while the guest form holds a prebooked room or a food cart is in checkout.
    if (supports("6.2")) {
      if (view === "guest" || view === "food-checkout") tg.enableClosingConfirmation();
      else tg.disableClosingConfirmation();
    }

    views[view]();
    window.scrollTo(0, 0);
  }

  function goBack() {
    if (state.busy) return;
    const target = backTargets[state.view];
    if (!target) return;
    haptic.impact("light");
    show(target);
  }

  function switchTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    for (const button of $$("#tabs button")) button.classList.toggle("active", button.dataset.tab === tab);
    haptic.select();
    show(`${tab}-form`);
  }

  // ---------- Forms ----------

  function stepperValue(name) {
    return Number($(`.stepper[data-name="${name}"] output`).value);
  }

  function readForm(form) {
    for (const input of form.querySelectorAll("input")) input.classList.add("touched");
    if (!form.reportValidity()) {
      haptic.notify("error");
      return null;
    }
    return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value).trim()]));
  }

  function sendToChat(payload) {
    if (!inTelegram) {
      showAlert("Open this app from the bot in Telegram to search.");
      return;
    }
    haptic.notify("success");
    // sendData closes the Mini App and delivers a web_app_data message to the bot.
    tg.sendData(JSON.stringify(payload));
  }

  async function submitFlightSearch() {
    const data = readForm($("#flight-form"));
    if (!data) return;

    const search = {
      origin: data.origin,
      destination: data.destination,
      departureDate: data.departureDate,
      returnDate: data.returnDate || undefined,
      passengers: stepperValue("passengers"),
    };
    if (search.returnDate && search.returnDate < search.departureDate) {
      showAlert("The return date must be on or after the departure date.");
      return;
    }

    // Awaited so the CloudStorage write finishes before sendData closes the app.
    await saveRecent("recent_flights", { origin: search.origin, destination: search.destination },
      (item) => `${item.origin}|${item.destination}`.toLowerCase());

    if (!canUseApi) {
      sendToChat({ type: "flight_search", ...search });
      return;
    }

    run(async () => {
      state.flights = [];
      state.selectedFlight = null;
      $("#flight-results").replaceChildren();
      $("#flight-results-title").textContent = `${search.origin} → ${search.destination}`;
      show("flight-results");
      setLoading(true, "Searching flights…");

      const result = await api("/api/flights/search", search);
      state.flights = result.offers;
      $("#flight-results-title").textContent =
        `${result.origin} → ${result.destination} · ${plural(search.passengers, "passenger")}`;
      renderFlights();
      haptic.notify(result.offers.length ? "success" : "warning");
    }, () => show("flights-form"));
  }

  async function submitHotelSearch() {
    const data = readForm($("#hotel-form"));
    if (!data) return;

    const nights = stepperValue("nights");
    const search = {
      destination: data.destination,
      checkin: data.checkin,
      checkout: addDays(data.checkin, nights),
      adults: stepperValue("adults"),
    };

    await saveRecent("recent_hotels", { destination: search.destination }, (item) => item.destination.toLowerCase());

    if (!canUseApi) {
      sendToChat({ type: "hotel_search", ...search });
      return;
    }

    run(async () => {
      state.hotels = [];
      state.selectedHotel = null;
      $("#hotel-results").replaceChildren();
      $("#hotel-results-title").textContent = search.destination;
      show("hotel-results");
      setLoading(true, `Searching hotels in ${search.destination}…`);

      const result = await api("/api/hotels/search", search);
      state.hotels = result.offers;
      $("#hotel-results-title").textContent =
        `${search.destination} · ${plural(nights, "night")} · ${plural(search.adults, "adult")}`;
      renderHotels();
      haptic.notify(result.offers.length ? "success" : "warning");
    }, () => show("hotels-form"));
  }

  // ---------- Results ----------

  function renderOffers(container, offers, emptyText, buildCard, onSelect) {
    if (!offers.length) {
      container.replaceChildren(el("div", "empty", emptyText));
      return;
    }

    container.replaceChildren(...offers.map((offer) => {
      const card = buildCard(offer);
      card.addEventListener("click", () => {
        for (const other of container.children) other.classList.toggle("selected", other === card);
        haptic.select();
        onSelect(offer);
      });
      return card;
    }));
  }

  function renderFlights() {
    renderOffers($("#flight-results"), state.flights, "No flights found for that route and date.", (offer) => {
      const card = el("button", "offer");
      card.type = "button";
      const top = el("div", "top");
      top.append(el("span", "", offer.airline), el("span", "price", `${offer.totalCurrency} ${offer.totalAmount}`));
      const duration = formatDuration(offer.duration);
      card.append(
        top,
        el("div", "meta", `${formatFlightTime(offer.departure)} → ${formatFlightTime(offer.arrival)}`),
        el("span", "tag", [offer.stops === 0 ? "Direct" : plural(offer.stops, "stop"), duration].filter(Boolean).join(" · ")),
      );
      return card;
    }, (offer) => {
      state.selectedFlight = offer;
      views["flight-results"]();
    });
  }

  function renderHotels() {
    renderOffers($("#hotel-results"), state.hotels, "No hotels found. Try another destination or dates.", (offer) => {
      const card = el("button", "offer");
      card.type = "button";
      const top = el("div", "top");
      top.append(el("span", "", offer.hotelName), el("span", "price", `${offer.totalCurrency} ${offer.totalAmount.toFixed(2)}`));
      card.append(top);
      if (offer.address) card.append(el("div", "meta", offer.address));
      const rating = [
        offer.stars ? "⭐".repeat(Math.round(offer.stars)) : "",
        offer.rating ? `${offer.rating}/10${offer.reviewCount ? ` (${offer.reviewCount})` : ""}` : "",
      ].filter(Boolean).join("  ");
      if (rating) card.append(el("div", "meta", rating));
      card.append(
        el("div", "meta", [offer.roomName, offer.boardName].filter(Boolean).join(" · ")),
        el("span", "tag", offer.refundable ? "Refundable" : "Non-refundable"),
      );
      return card;
    }, (offer) => {
      state.selectedHotel = offer;
      views["hotel-results"]();
    });
  }

  function selectFlight() {
    const offer = state.selectedFlight;
    if (!offer) return;

    run(async () => {
      setMainProgress(true);
      const result = await api("/api/flights/select", { offerId: offer.id });
      haptic.notify("success");
      // answerWebAppQuery closes the app itself; a direct message needs an explicit close.
      if (result.sentVia === "message") tg.close();
    });
  }

  function share(payload) {
    run(async () => {
      const { id } = await api("/api/share", payload);
      tg.shareMessage(id, (sent) => { if (sent) haptic.notify("success"); });
    });
  }

  // ---------- Hotel booking ----------

  function prebookSelectedHotel() {
    const offer = state.selectedHotel;
    if (!offer) return;

    run(async () => {
      setMainProgress(true);
      const prebook = await api("/api/hotels/prebook", { key: offer.key });
      state.prebook = prebook;

      const summary = $("#prebook-summary");
      summary.replaceChildren(
        el("div", "", offer.hotelName),
        el("div", "hint", `${offer.roomName} · ${offer.checkin} → ${offer.checkout} · ${plural(offer.adults, "adult")}`),
        el("div", "hint", offer.refundable ? "Refundable" : "Non-refundable"),
        el("div", "price", `${prebook.currency} ${prebook.price.toFixed(2)}`),
      );
      if (prebook.priceChanged) summary.append(el("div", "warn", "⚠️ The price changed since your search."));
      if (prebook.cancellationChanged) summary.append(el("div", "warn", "⚠️ The cancellation terms changed since your search."));

      await prefillGuest();
      haptic.notify(prebook.priceChanged ? "warning" : "success");
      show("guest");
    });
  }

  async function prefillGuest() {
    const form = $("#guest-form");
    const saved = await getJson("guest", null);
    const user = tg?.initDataUnsafe?.user;
    form.firstName.value ||= saved?.firstName ?? user?.first_name ?? "";
    form.lastName.value ||= saved?.lastName ?? user?.last_name ?? "";
    form.email.value ||= saved?.email ?? "";
  }

  async function bookHotel() {
    const guest = readForm($("#guest-form"));
    if (!guest || !state.prebook) return;

    const offer = state.selectedHotel;
    const { prebook } = state;
    const confirmed = await showConfirm(
      `Book ${offer.hotelName} for ${prebook.currency} ${prebook.price.toFixed(2)} in the name of ${guest.firstName} ${guest.lastName}?`,
    );
    if (!confirmed) return;

    run(async () => {
      setMainProgress(true);
      const booking = await api("/api/hotels/book", { prebookId: prebook.prebookId, guest });
      await storage.set("guest", JSON.stringify(guest));

      $("#booked-title").textContent = `Booking ${booking.status.toLowerCase()}`;
      const summary = $("#booked-summary");
      summary.replaceChildren(
        el("div", "", booking.hotelName ?? offer.hotelName),
        el("div", "hint", `${booking.checkin ?? offer.checkin} → ${booking.checkout ?? offer.checkout}`),
        el("div", "hint", `Guest: ${guest.firstName} ${guest.lastName}`),
        el("div", "", `Booking ID: ${booking.bookingId}`),
      );
      if (booking.hotelConfirmationCode) {
        summary.append(el("div", "", `Hotel confirmation: ${booking.hotelConfirmationCode}`));
      }

      state.prebook = null;
      haptic.notify("success");
      show("booked");
    });
  }

  // ---------- Food ordering (test) ----------

  // Mirrors the server's fees so the cart shows the total before ordering.
  const SERVICE_FEE = 2;
  const VAT_RATE = 0.05;
  const CUISINES = ["Biryani", "Shawarma", "Pizza", "Sushi", "Burgers", "Healthy", "Coffee"];

  function money(amount) {
    return `AED ${amount.toFixed(2)}`;
  }

  function cartTotals() {
    const { restaurant, menu, cart } = state.food;
    let count = 0;
    let subtotal = 0;
    for (const [itemId, quantity] of cart) {
      const item = menu.find((menuItem) => menuItem.id === itemId);
      if (!item) continue;
      count += quantity;
      subtotal += item.price * quantity;
    }
    const deliveryFee = restaurant?.deliveryFee ?? 0;
    const vat = Math.round((subtotal + deliveryFee + SERVICE_FEE) * VAT_RATE * 100) / 100;
    return { count, subtotal, deliveryFee, vat, total: subtotal + deliveryFee + SERVICE_FEE + vat };
  }

  async function submitFoodSearch() {
    const data = readForm($("#food-form"));
    if (!data) return;

    run(async () => {
      state.food.restaurants = [];
      $("#food-results").replaceChildren();
      $("#food-results-title").textContent = data.area;
      show("food-results");
      setLoading(true, "Finding restaurants…");

      const result = await api("/api/food/restaurants", { area: data.area, query: data.query || undefined });
      state.food.area = result.area;
      state.food.restaurants = result.restaurants;
      $("#food-form").area.value = result.area;
      await storage.set("food_area", result.area);

      $("#food-results-title").textContent = data.query ? `${data.query} in ${result.area}` : `Restaurants in ${result.area}`;
      renderRestaurants();
      haptic.notify(result.restaurants.length ? "success" : "warning");
    }, () => show("food-form"));
  }

  function renderRestaurants() {
    renderOffers($("#food-results"), state.food.restaurants, "No restaurants found. Try another area or dish.", (restaurant) => {
      const card = el("button", "offer");
      card.type = "button";
      const top = el("div", "top");
      top.append(el("span", "", `${restaurant.emoji} ${restaurant.name}`), el("span", "price", `⭐ ${restaurant.rating}`));
      card.append(
        top,
        el("div", "meta", `${restaurant.cuisine} · ${restaurant.etaMinutes} min`),
        el("span", "tag", [
          restaurant.deliveryFee ? `Delivery ${money(restaurant.deliveryFee)}` : "Free delivery",
          `Min ${money(restaurant.minimumOrder)}`,
        ].join(" · ")),
      );
      return card;
    }, openRestaurant);
  }

  function openRestaurant(restaurant) {
    run(async () => {
      setLoading(true, "Loading menu…");
      const { menu } = await api("/api/food/menu", { restaurantId: restaurant.id });
      // A cart only holds items from one restaurant.
      if (state.food.restaurant?.id !== restaurant.id) state.food.cart = new Map();
      state.food.restaurant = restaurant;
      state.food.menu = menu;

      $("#food-menu-title").textContent = `${restaurant.emoji} ${restaurant.name}`;
      $("#food-menu-meta").textContent =
        `${restaurant.cuisine} · ⭐ ${restaurant.rating} · ${restaurant.etaMinutes} min · Min order ${money(restaurant.minimumOrder)}`;
      renderMenu();
      show("food-menu");
    });
  }

  function renderMenu() {
    const groups = new Map();
    for (const item of state.food.menu) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }

    const sections = [];
    for (const [category, items] of groups) {
      const card = el("div", "card menu-group");
      card.append(el("div", "menu-category", category), ...items.map(menuRow));
      sections.push(card);
    }
    $("#food-menu").replaceChildren(...sections);
  }

  function menuRow(item) {
    const row = el("div", "menu-item");
    const info = el("div", "info");
    info.append(el("div", "name", `${item.veg ? "🟢 " : ""}${item.name}`));
    if (item.description) info.append(el("div", "hint", item.description));
    info.append(el("div", "item-price", money(item.price)));

    const control = el("div", "qty");
    const update = () => {
      const quantity = state.food.cart.get(item.id) ?? 0;
      if (!quantity) {
        const add = el("button", "add", "Add");
        add.type = "button";
        add.addEventListener("click", () => changeQuantity(item.id, 1, update));
        control.replaceChildren(add);
        return;
      }
      const minus = el("button", "", "−");
      const plus = el("button", "", "+");
      minus.type = plus.type = "button";
      minus.setAttribute("aria-label", `Remove one ${item.name}`);
      plus.setAttribute("aria-label", `Add one ${item.name}`);
      minus.addEventListener("click", () => changeQuantity(item.id, -1, update));
      plus.addEventListener("click", () => changeQuantity(item.id, 1, update));
      control.replaceChildren(minus, el("output", "", String(quantity)), plus);
    };
    update();

    row.append(info, control);
    return row;
  }

  function changeQuantity(itemId, step, update) {
    const { cart } = state.food;
    const next = (cart.get(itemId) ?? 0) + step;
    if (next > 20) {
      haptic.notify("warning");
      return;
    }
    if (next <= 0) cart.delete(itemId);
    else cart.set(itemId, next);
    haptic.impact("light");
    update();
    views["food-menu"]();
  }

  async function clearCart() {
    if (!(await showConfirm("Remove all items from your cart?"))) return;
    state.food.cart = new Map();
    renderMenu();
    views["food-menu"]();
  }

  async function openCheckout() {
    const { restaurant, menu, cart } = state.food;
    const totals = cartTotals();
    const summary = $("#food-cart-summary");
    summary.replaceChildren(el("div", "", `${restaurant.emoji} ${restaurant.name}`));
    for (const [itemId, quantity] of cart) {
      const item = menu.find((menuItem) => menuItem.id === itemId);
      if (!item) continue;
      summary.append(lineRow(`${quantity} × ${item.name}`, money(item.price * quantity)));
    }
    summary.append(
      lineRow("Delivery fee", totals.deliveryFee ? money(totals.deliveryFee) : "Free", "hint"),
      lineRow("Service fee", money(SERVICE_FEE), "hint"),
      lineRow("VAT (5%)", money(totals.vat), "hint"),
      lineRow("Total", money(totals.total), "price"),
      el("div", "hint", `Delivering to ${state.food.area}`),
    );

    const form = $("#delivery-form");
    const saved = await getJson("delivery", null);
    const user = tg?.initDataUnsafe?.user;
    form.name.value ||= saved?.name ?? [user?.first_name, user?.last_name].filter(Boolean).join(" ");
    form.phone.value ||= saved?.phone ?? "";
    form.address.value ||= saved?.address ?? "";

    haptic.impact("light");
    show("food-checkout");
  }

  function lineRow(label, value, className = "") {
    const row = el("div", `line ${className}`.trim());
    row.append(el("span", "", label), el("span", "", value));
    return row;
  }

  async function placeFoodOrder() {
    const delivery = readForm($("#delivery-form"));
    if (!delivery) return;

    const { restaurant, cart, area } = state.food;
    const confirmed = await showConfirm(
      `Place a test order from ${restaurant.name} for ${money(cartTotals().total)} to ${delivery.address}, ${area}?`,
    );
    if (!confirmed) return;

    run(async () => {
      setMainProgress(true);
      const order = await api("/api/food/order", {
        restaurantId: restaurant.id,
        area,
        lines: [...cart].map(([itemId, quantity]) => ({ itemId, quantity })),
        delivery,
      });
      await storage.set("delivery", JSON.stringify({ name: delivery.name, phone: delivery.phone, address: delivery.address }));

      state.food.order = order;
      state.food.cart = new Map();
      $("#food-order-summary").replaceChildren(
        el("div", "", `${restaurant.emoji} ${order.restaurantName}`),
        ...order.lines.map((line) => lineRow(`${line.quantity} × ${line.name}`, money(line.total))),
        lineRow("Total (cash on delivery)", money(order.total), "price"),
        el("div", "hint", `Order ID: ${order.orderId}`),
      );
      renderOrderStatus(order.status);
      haptic.notify("success");
      show("food-ordered");
      startOrderPolling();
    });
  }

  const STATUS_STEPS = [
    { status: "placed", label: "Order placed", emoji: "🧾" },
    { status: "preparing", label: "Preparing your food", emoji: "👨‍🍳" },
    { status: "out_for_delivery", label: "Rider on the way", emoji: "🛵" },
    { status: "delivered", label: "Delivered", emoji: "✅" },
  ];

  function renderOrderStatus(status) {
    const currentIndex = Math.max(0, STATUS_STEPS.findIndex((step) => step.status === status));
    const current = STATUS_STEPS[currentIndex];
    $("#food-status-emoji").textContent = current.emoji;
    $("#food-status-title").textContent = status === "delivered"
      ? "Enjoy your meal!"
      : `${current.label} · ETA ${state.food.order?.etaMinutes ?? "–"} min`;
    $("#food-timeline").replaceChildren(...STATUS_STEPS.map((step, index) =>
      el("li", index < currentIndex ? "done" : index === currentIndex ? "current" : "", step.label)));
  }

  function startOrderPolling() {
    stopOrderPolling();
    state.food.poll = setInterval(async () => {
      const { order } = state.food;
      if (!order) return stopOrderPolling();
      try {
        const { status } = await api("/api/food/status", { orderId: order.orderId });
        if (status !== order.status) {
          order.status = status;
          renderOrderStatus(status);
          haptic.notify("success");
        }
        if (status === "delivered") stopOrderPolling();
      } catch {
        stopOrderPolling();
      }
    }, 5000);
  }

  function stopOrderPolling() {
    clearInterval(state.food.poll);
    state.food.poll = null;
  }

  async function setupFood() {
    const form = $("#food-form");
    form.area.value = (await storage.get("food_area")) ?? "";

    $("#food-cuisines").replaceChildren(el("span", "label", "Popular"), ...CUISINES.map((cuisine) => {
      const chip = el("button", "", cuisine);
      chip.type = "button";
      chip.addEventListener("click", () => { haptic.select(); form.query.value = cuisine; });
      return chip;
    }));

    if (canUseApi) {
      api("/api/food/areas").then(({ areas }) => {
        $("#food-areas").replaceChildren(...areas.map((area) => {
          const option = document.createElement("option");
          option.value = area;
          return option;
        }));
      }).catch(() => {});
    }
  }

  // ---------- Recent searches ----------

  async function saveRecent(key, item, identity) {
    const items = await getJson(key, []);
    const next = [item, ...items.filter((other) => identity(other) !== identity(item))].slice(0, 5);
    await storage.set(key, JSON.stringify(next));
    renderRecent();
  }

  function renderChips(container, items, label, onPick) {
    if (!items.length) {
      container.replaceChildren();
      return;
    }
    container.replaceChildren(el("span", "label", "Recent searches"), ...items.map((item) => {
      const chip = el("button", "", label(item));
      chip.type = "button";
      chip.addEventListener("click", () => { haptic.select(); onPick(item); });
      return chip;
    }));
  }

  async function renderRecent() {
    const [flights, hotels] = await Promise.all([getJson("recent_flights", []), getJson("recent_hotels", [])]);
    renderChips($("#recent-flights"), flights, (item) => `${item.origin} → ${item.destination}`, (item) => {
      const form = $("#flight-form");
      form.origin.value = item.origin;
      form.destination.value = item.destination;
    });
    renderChips($("#recent-hotels"), hotels, (item) => item.destination, (item) => {
      $("#hotel-form").destination.value = item.destination;
    });
  }

  // ---------- Settings ----------

  async function openSettings() {
    const homeStatus = supports("8.0")
      ? await new Promise((resolve) => tg.checkHomeScreenStatus(resolve))
      : "unsupported";

    // showPopup accepts at most three buttons.
    const buttons = [];
    if (supports("8.0")) {
      buttons.push({ id: "fullscreen", type: "default", text: tg.isFullscreen ? "Exit full screen" : "Full screen" });
    }
    if (homeStatus === "missed" || homeStatus === "unknown") {
      buttons.push({ id: "home", type: "default", text: "Add to home screen" });
    }
    buttons.push({ id: "clear", type: "destructive", text: "Clear saved data" });
    if (buttons.length < 3) buttons.push({ type: "cancel" });

    tg.showPopup({
      title: "Settings",
      message: "Recent searches, guest and delivery details are saved to your Telegram account.",
      buttons,
    }, async (buttonId) => {
      if (buttonId === "fullscreen") {
        if (tg.isFullscreen) tg.exitFullscreen();
        else tg.requestFullscreen();
      } else if (buttonId === "home") {
        tg.addToHomeScreen();
      } else if (buttonId === "clear") {
        await storage.remove(["recent_flights", "recent_hotels", "guest", "food_area", "delivery"]);
        $("#guest-form").reset();
        $("#delivery-form").reset();
        $("#food-form").area.value = "";
        renderRecent();
        haptic.notify("success");
      }
    });
  }

  // ---------- Setup ----------

  function setupSteppers() {
    for (const stepper of $$(".stepper")) {
      const output = stepper.querySelector("output");
      const min = Number(stepper.dataset.min);
      const max = Number(stepper.dataset.max);
      output.value = output.textContent;

      stepper.addEventListener("click", (event) => {
        const step = Number(event.target.dataset?.step);
        if (!step) return;
        const next = Math.min(max, Math.max(min, Number(output.value) + step));
        if (next === Number(output.value)) {
          haptic.notify("warning");
          return;
        }
        output.value = String(next);
        haptic.select();
      });
    }
  }

  function setupDates() {
    const tomorrow = isoDate(new Date(Date.now() + 86400000));
    for (const input of $$('input[type="date"]')) input.min = tomorrow;

    const flightForm = $("#flight-form");
    flightForm.departureDate.value = tomorrow;
    flightForm.departureDate.addEventListener("change", () => {
      flightForm.returnDate.min = flightForm.departureDate.value || tomorrow;
    });
    $("#hotel-form").checkin.value = tomorrow;
  }

  function setupTelegram() {
    if (!inTelegram) return;

    tg.ready();
    tg.expand();
    if (supports("6.1")) {
      tg.setHeaderColor("secondary_bg_color");
      tg.setBackgroundColor("secondary_bg_color");
    }
    if (supports("7.10")) tg.setBottomBarColor("secondary_bg_color");
    // Keep vertical swipes for scrolling results instead of minimizing the app.
    if (supports("7.7")) tg.disableVerticalSwipes();

    tg.MainButton.onClick(() => mainHandler?.());
    if (supports("7.10")) tg.SecondaryButton.onClick(() => secondaryHandler?.());
    if (supports("6.1")) tg.BackButton.onClick(goBack);
    if (supports("7.0")) {
      tg.SettingsButton.show();
      tg.SettingsButton.onClick(openSettings);
    }
    if (supports("8.0")) {
      tg.onEvent("fullscreenFailed", ({ error }) => {
        if (error !== "ALREADY_FULLSCREEN") showAlert("Full screen isn't available on this device.");
      });
      tg.onEvent("shareMessageFailed", ({ error }) => {
        if (error !== "USER_DECLINED") showAlert("Couldn't share that message. Please try again.");
      });
    }
  }

  function setup() {
    setupTelegram();
    setupSteppers();
    setupDates();

    fallbackMain.addEventListener("click", () => mainHandler?.());
    fallbackSecondary.addEventListener("click", () => secondaryHandler?.());

    for (const button of $$("#tabs button")) {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    }

    $("#swap-route").addEventListener("click", () => {
      const form = $("#flight-form");
      [form.origin.value, form.destination.value] = [form.destination.value, form.origin.value];
      haptic.impact("light");
    });

    // Enter on the keyboard submits like the main button.
    for (const form of $$("form")) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        mainHandler?.();
      });
    }

    renderRecent();
    setupFood();

    if (canUseApi) {
      api("/api/config").then((config) => { state.config = config; }).catch(() => {});
    }

    // Deep links such as t.me/<bot>/<app>?startapp=hotels and the bot's
    // "Book hotels" and "Order food" buttons (?tab=hotels, ?tab=food) open the matching tab.
    const startTab = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("tab");
    if (startTab === "hotels" || startTab === "food") switchTab(startTab);
    else show("flights-form");
  }

  setup();
})();
