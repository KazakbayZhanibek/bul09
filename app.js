(() => {
  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');
  const header = document.querySelector('.site-header');

  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    menu.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
  }
  menu.addEventListener('click', event => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    setMenu(open);
    if (open && event.detail === 0) nav.querySelector('a').focus();
  });
  header.addEventListener('click', event => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setMenu(false);
  });
  header.addEventListener('focusout', event => {
    if (!header.contains(event.relatedTarget)) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menu.focus();
    }
  });
  matchMedia('(min-width: 701px)').addEventListener('change', () => setMenu(false));

  const slides = [
    { product: 'leopard', color: 2, file: 'canyon', mobile: 'canyon-mobile', label: 'Барс в каньоне', alt: 'Песочная футболка с принтом «Барс» на фоне скал каньона.' },
    { product: 'eagle', color: 0, file: 'hero', mobile: 'hero-mobile', label: 'Беркут в горах', alt: 'Беркут на спине чёрной футболки. Модель на фоне горного хребта.' },
    { product: 'horse', color: 1, file: 'grassland', mobile: 'grassland-mobile', label: 'Всадник в степи', alt: 'Мужчина ведёт лошадь по степи. На футболке цвета хаки — принт «Всадник».' }
  ];
  const hero = document.querySelector('.hero');
  const heroImage = document.getElementById('campaign-image');
  const mobileSource = document.querySelector('#campaign-picture source');
  const photoProduct = document.querySelector('.photo-product');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let currentFrame = 0;
  let previousPhoto;

  function changeFrame(direction) {
    previousPhoto?.remove();
    let snapshot;
    if (!reducedMotion.matches && heroImage.complete && heroImage.naturalWidth) {
      snapshot = new Image();
      snapshot.alt = '';
      snapshot.className = 'previous-photo';
      snapshot.src = heroImage.currentSrc;
      snapshot.style.objectPosition = getComputedStyle(heroImage).objectPosition;
      heroImage.parentElement.after(snapshot);
    }
    previousPhoto = snapshot;
    currentFrame = (currentFrame + direction + slides.length) % slides.length;
    const slide = slides[currentFrame];
    hero.dataset.frame = String(currentFrame);
    mobileSource.srcset = `assets/editorial/${slide.mobile ?? slide.file}.webp`;
    heroImage.src = `assets/editorial/${slide.file}.webp`;
    heroImage.alt = slide.alt;
    document.getElementById('photo-index').textContent = String(currentFrame + 1).padStart(2, '0');
    document.getElementById('photo-name').textContent = slide.label;
    photoProduct.setAttribute('aria-label', `Рассмотреть принт «${products.find(product => product.id === slide.product).name}» на фото`);
    if (snapshot) {
      heroImage.decode().then(() => {
        if (!snapshot.isConnected) return;
        const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
        fade.onfinish = () => snapshot.remove();
      }).catch(() => snapshot.remove());
    }
  }

  hero.addEventListener('click', event => {
    const control = event.target.closest('[data-photo]');
    if (control) changeFrame(Number(control.dataset.photo));
  });
  let touchOrigin;
  hero.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target.closest('a, button')) {
      touchOrigin = null;
      return;
    }
    const { clientX, clientY } = event.touches[0];
    touchOrigin = { x: clientX, y: clientY };
  }, { passive: true });
  hero.addEventListener('touchend', event => {
    if (!touchOrigin) return;
    const { clientX, clientY } = event.changedTouches[0];
    const dx = clientX - touchOrigin.x;
    const dy = clientY - touchOrigin.y;
    if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.6) changeFrame(dx < 0 ? 1 : -1);
    touchOrigin = null;
  }, { passive: true });
  hero.addEventListener('touchcancel', () => { touchOrigin = null; }, { passive: true });

  const { products, colors } = BulbulCollection;
  const chosenColors = new Map(products.map(product => [product.id, product.initialColor]));
  const catalog = document.getElementById('products');
  const dialog = document.getElementById('product-dialog');
  const dialogImage = document.getElementById('product-image');
  const detailSwatches = document.getElementById('detail-swatches');
  let inspected = products[0];
  let showingFront = false;
  let opener;
  let goingToStudio = false;

  const art = (product, color, front = false) => `assets/editorial/${product.id}-${front ? 'front' : color.file}.webp`;
  const backLabel = (product, color) => `Футболка «${product.name}», цвет ${color.name.toLowerCase()}, вид со спины`;

  function swatches(product) {
    return colors.map((color, index) => `<button type="button" class="color-swatch" data-color="${index}"
      aria-pressed="${index === chosenColors.get(product.id)}" aria-label="${color.name}" title="${color.name}"
      style="--swatch:${color.hex}"></button>`).join('');
  }

  catalog.innerHTML = products.map(product => {
    const color = colors[chosenColors.get(product.id)];
    return `<article class="product-card" id="print-${product.id}" data-product="${product.id}">
      <button class="card-image" type="button" data-open aria-haspopup="dialog" aria-label="Рассмотреть принт «${product.name}»">
        <img src="${art(product, color)}" alt="${backLabel(product, color)}" loading="lazy" decoding="async" width="810" height="1000">
        <span class="card-inspect" aria-hidden="true"><svg class="icon"><use href="#i-plus"/></svg></span>
      </button>
      <div class="card-info"><h3><button class="card-name" type="button" data-open aria-haspopup="dialog">${product.name}</button></h3>
        <div class="swatches" role="group" aria-label="Цвет футболки «${product.name}»">${swatches(product)}</div>
      </div><div class="card-foot"><p class="card-caption">${product.caption}</p><span class="card-color-name">${color.name}</span></div>
    </article>`;
  }).join('');

  const printNav = document.querySelector('.print-nav');
  const cards = Array.from(catalog.children);
  const mobileCatalog = matchMedia('(max-width: 640px)');
  printNav.innerHTML = products.map((product, index) => `<button type="button" data-print="${index}"
    aria-controls="print-${product.id}" aria-pressed="${index === 0}">${product.name}</button>`).join('');
  printNav.hidden = false;

  function goToCard(index, animate) {
    if (!mobileCatalog.matches) return;
    catalog.scrollTo({
      left: cards[index].offsetLeft - cards[0].offsetLeft,
      behavior: animate && !reducedMotion.matches ? 'smooth' : 'instant'
    });
  }
  function syncPrintNav() {
    if (!mobileCatalog.matches) return;
    const middle = catalog.getBoundingClientRect().left + catalog.clientWidth / 2;
    let nearest = 0;
    let distance = Infinity;
    cards.forEach((card, index) => {
      const bounds = card.getBoundingClientRect();
      const gap = Math.abs(bounds.left + bounds.width / 2 - middle);
      if (gap < distance) { distance = gap; nearest = index; }
    });
    Array.from(printNav.children).forEach((button, index) => {
      const current = index === nearest;
      cards[index].classList.toggle('in-view', current);
      if (button.getAttribute('aria-pressed') !== String(current)) button.setAttribute('aria-pressed', String(current));
    });
  }
  catalog.addEventListener('scroll', syncPrintNav, { passive: true });
  catalog.addEventListener('focusin', event => {
    const card = event.target.closest('.product-card');
    if (card && event.target.matches(':focus-visible')) goToCard(cards.indexOf(card), false);
  });
  window.addEventListener('resize', syncPrintNav);
  syncPrintNav();
  printNav.addEventListener('click', event => {
    const button = event.target.closest('[data-print]');
    if (button) goToCard(Number(button.dataset.print), true);
  });
  printNav.addEventListener('keydown', event => {
    const index = Number(event.target.dataset.print);
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: cards.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(cards.length - 1, next));
    printNav.children[target].focus({ preventScroll: true });
    goToCard(target, true);
  });

  function updateSwatches(group, index) {
    group.querySelectorAll('[data-color]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.color) === index));
    });
  }

  function setColor(product, index) {
    chosenColors.set(product.id, index);
    const card = catalog.querySelector(`[data-product="${product.id}"]`);
    const image = card.querySelector('img');
    image.src = art(product, colors[index]);
    image.alt = backLabel(product, colors[index]);
    card.querySelector('.card-color-name').textContent = colors[index].name;
    updateSwatches(card, index);
  }

  function updateDetail() {
    const index = chosenColors.get(inspected.id);
    const color = colors[index];
    dialogImage.src = art(inspected, color, showingFront);
    dialogImage.alt = showingFront ? `Чёрная футболка «${inspected.name}», исходный эскиз знака на груди` : backLabel(inspected, color);
    document.getElementById('color-purpose').textContent = showingFront ? 'Цвет модели в 3D' : 'Цвет футболки';
    document.getElementById('product-color').textContent = color.name;
    updateSwatches(detailSwatches, index);
    dialog.querySelector('.front-note').hidden = !showingFront;
    dialog.querySelectorAll('[data-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.view === (showingFront ? 'front' : 'back')));
    });
  }

  function openProduct(product, trigger) {
    inspected = product;
    opener = trigger;
    goingToStudio = false;
    showingFront = false;
    document.getElementById('product-title').textContent = product.name;
    document.getElementById('product-latin').textContent = product.subtitle;
    document.getElementById('product-description').textContent = product.description;
    detailSwatches.innerHTML = swatches(product);
    updateDetail();
    dialog.showModal();
    dialog.scrollTop = 0;
    document.body.classList.add('modal-open');
    dialog.querySelector('.dialog-close').focus({ preventScroll: true });
  }

  photoProduct.addEventListener('click', event => {
    event.preventDefault();
    const shot = slides[currentFrame];
    const product = products.find(item => item.id === shot.product);
    setColor(product, shot.color);
    openProduct(product, photoProduct);
  });
  photoProduct.setAttribute('aria-haspopup', 'dialog');

  catalog.addEventListener('click', event => {
    const card = event.target.closest('[data-product]');
    if (!card) return;
    const product = products.find(item => item.id === card.dataset.product);
    const trigger = event.target.closest('[data-open]');
    const swatch = event.target.closest('[data-color]');
    if (trigger) openProduct(product, trigger);
    if (swatch) {
      const index = Number(swatch.dataset.color);
      setColor(product, index);
      window.BulbulStudio?.setProduct(product.id, index);
    }
  });

  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('.dialog-close')) {
      dialog.close();
      return;
    }
    const view = event.target.closest('[data-view]');
    const swatch = event.target.closest('[data-color]');
    if (view) {
      showingFront = view.dataset.view === 'front';
      updateDetail();
    }
    if (swatch) {
      const index = Number(swatch.dataset.color);
      setColor(inspected, index);
      updateDetail();
      window.BulbulStudio?.setProduct(inspected.id, index);
    }
    if (event.target.closest('#product-studio')) {
      goingToStudio = true;
      window.BulbulStudio?.setProduct(inspected.id, chosenColors.get(inspected.id), showingFront ? 'front' : 'back');
      dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    if (goingToStudio) {
      const title = document.getElementById('studio-title');
      if (title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
      }
    } else if (document.activeElement === document.body) {
      opener?.focus({ preventScroll: true });
    }
  });
  window.addEventListener('bulbulstudiochange', event => {
    const product = products.find(item => item.id === event.detail.id);
    if (product && colors[event.detail.color]) {
      setColor(product, event.detail.color);
      goToCard(products.indexOf(product), false);
    }
  });
})();
