(() => {
  const section = document.getElementById('studio');
  if (!section) return;

  const { products: designs, colors } = BulbulCollection;
  const selectedColors = new Map(designs.map(design => [design.id, design.initialColor]));
  let selected = designs[0];
  let colorIndex = selected.initialColor;

  section.setAttribute('aria-labelledby', 'studio-title');
  section.innerHTML = `
    <span id="studio-fabric" class="studio-anchor" aria-hidden="true"></span>
    <div class="studio-inner" id="view3d">
      <div class="studio-heading">
        <h2 id="studio-title">3D-студия</h2>
        <p>Поверните футболку мышью или касанием.<br>Откройте крупный план, чтобы увидеть ткань и швы.</p>
      </div>
      <div class="studio-layout">
        <div class="studio-settings">
          <fieldset class="studio-designs">
            <legend>Дизайн</legend>
            ${designs.map((design, index) => `
              <label class="studio-design">
                <input type="radio" name="studio-design" value="${design.id}" ${index === 0 ? 'checked' : ''}>
                <span class="studio-design-name">${design.name}</span>
                <span class="studio-design-en" lang="en">${design.subtitle}</span>
                <span class="studio-radio-mark" aria-hidden="true"></span>
              </label>
            `).join('')}
          </fieldset>
          <fieldset class="studio-colors">
            <legend>Цвет <span class="studio-color-name">${colors[colorIndex].name}</span></legend>
            <div class="studio-swatch-list">
              ${colors.map((color, index) => `
                <label class="studio-swatch" style="--studio-swatch:${color.hex}" title="${color.name}">
                  <input type="radio" name="studio-color" value="${index}" aria-label="${color.name}" ${index === colorIndex ? 'checked' : ''}>
                  <span aria-hidden="true"></span>
                </label>
              `).join('')}
            </div>
          </fieldset>
        </div>
        <div class="studio-board" data-mode="pending">
          <div class="studio-viewport">
            <div id="shirt3d" data-model-src="assets/models/field-tee-v2.glb" aria-label="Объёмная модель футболки"></div>
            <div class="studio-poster" hidden><img src="assets/editorial/horse-khaki.webp" alt="Футболка «Всадник», цвет хаки, вид со спины" loading="lazy" decoding="async"></div>
            <span class="studio-frame" aria-hidden="true"></span>
            <span class="studio-view-caption" aria-hidden="true">${selected.name} · ${colors[colorIndex].name}</span>
            <button type="button" class="studio-zoom" aria-pressed="false"><span class="studio-lens" aria-hidden="true"></span><span>Крупный план</span></button>
          </div>
          <div class="studio-inspection" role="group" aria-label="Деталь крупным планом" hidden>
            <button type="button" data-area="print" aria-pressed="true">Принт</button>
            <button type="button" data-area="fabric" aria-pressed="false">Ткань</button>
            <button type="button" data-area="collar" aria-pressed="false">Ворот</button>
            <button type="button" data-area="hem" aria-pressed="false">Подол</button>
          </div>
          <div class="studio-tools">
            <p class="studio-feedback" role="status">Подготавливаем 3D-модель…</p>
          </div>
        </div>
        <div class="studio-meta">
          <a class="studio-catalog-link" href="#collection">К коллекции <span aria-hidden="true">↗</span></a>
          <p class="studio-note">Объёмный эскиз коллекции. Перед производством будут уточнены пропорции, ткань и расположение принта.</p>
          <p class="studio-credit">3D-основа · <a href="assets/models/ATTRIBUTION.txt">kylelhb, CC BY 4.0</a></p>
        </div>
      </div>
    </div>`;

  const board = section.querySelector('.studio-board');
  const viewer = section.querySelector('#shirt3d');
  const tools = section.querySelector('.studio-tools');
  const feedback = section.querySelector('.studio-feedback');
  const poster = section.querySelector('.studio-poster');
  const photo = poster.querySelector('img');
  const caption = section.querySelector('.studio-view-caption');
  const instructions = section.querySelector('.studio-heading p');
  const rotationInstructions = instructions.innerHTML;
  const colorName = section.querySelector('.studio-color-name');
  const moduleURL = new URL('garment-viewer.js?v=2', document.currentScript.src);
  const zoom = section.querySelector('.studio-zoom');
  const inspection = section.querySelector('.studio-inspection');
  let pendingSide;

  function updateCaption() {
    caption.textContent = selected.name + ' · ' + colors[colorIndex].name;
  }

  function toggleDetail(close) {
    window.Bulbul3D?.setDetail(close);
    board.dataset.detail = String(close);
    inspection.hidden = !close || board.dataset.mode !== 'ready';
    zoom.setAttribute('aria-pressed', String(close));
    zoom.lastElementChild.textContent = close ? 'Целиком' : 'Крупный план';
  }

  function selectInspection(area) {
    window.Bulbul3D?.setInspection(area);
    inspection.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.area === area));
    });
  }
  inspection.addEventListener('click', event => {
    const target = event.target.closest('[data-area]');
    if (target) selectInspection(target.dataset.area);
  });
  function inspectFabric() {
    toggleDetail(true);
    selectInspection('fabric');
  }
  window.addEventListener('hashchange', () => {
    if (location.hash === '#studio-fabric') inspectFabric();
  });
  document.addEventListener('click', event => {
    if (location.hash === '#studio-fabric' && !event.defaultPrevented &&
        !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
        event.target.closest('a[href="#studio-fabric"]')) inspectFabric();
  });

  function updatePoster() {
    const color = colors[colorIndex];
    const src = `assets/editorial/${selected.id}-${color.file}.webp`;
    if (photo.getAttribute('src') !== src) photo.src = src;
    photo.alt = `Футболка «${selected.name}», ${color.name.toLowerCase()} цвет, вид со спины`;
  }

  function showStatic() {
    board.dataset.mode = 'static';
    updatePoster();
    poster.hidden = false;
    instructions.textContent = 'Выберите принт и цвет, чтобы рассмотреть рисунок на спине.';
    updateCaption();
    inspection.hidden = true;
    feedback.textContent = '3D недоступно. Показана визуализация выбранной футболки.';
    feedback.hidden = false;
  }

  function showModel() {
    board.dataset.mode = 'ready';
    poster.hidden = true;
    instructions.innerHTML = rotationInstructions;
    updateCaption();
    inspection.hidden = board.dataset.detail !== 'true';
    feedback.hidden = true;
  }

  function setProduct(id, color, side) {
    const design = designs.find(item => item.id === id);
    const index = Number(color);
    if (!design || !Number.isInteger(index) || !colors[index]) return;
    selected = design;
    colorIndex = index;
    selectedColors.set(id, index);
    section.querySelector(`input[name="studio-design"][value="${id}"]`).checked = true;
    section.querySelector(`input[name="studio-color"][value="${index}"]`).checked = true;
    colorName.textContent = colors[index].name;
    updateCaption();
    if (side === 'front' || side === 'back') {
      toggleDetail(false);
      pendingSide = side;
    }
    if (!poster.hidden) updatePoster();
    if (window.Bulbul3D) {
      window.Bulbul3D.setProduct(id, index);
      if (pendingSide) window.Bulbul3D.setSide(pendingSide);
      pendingSide = undefined;
    }
  }

  section.addEventListener('change', event => {
    const input = event.target;
    if (input.name === 'studio-design') {
      setProduct(input.value, selectedColors.get(input.value) ?? 0);
    } else if (input.name === 'studio-color') {
      setProduct(selected.id, input.value);
    } else {
      return;
    }
    window.dispatchEvent(new CustomEvent('bulbulstudiochange', {
      detail: { id: selected.id, color: colorIndex }
    }));
  });
  window.BulbulStudio = { setProduct };
  zoom.addEventListener('click', () => toggleDetail(zoom.getAttribute('aria-pressed') !== 'true'));

  window.addEventListener('bulbul3dready', () => {
    const controls = viewer.querySelector('.viewer-controls');
    const [rotation, back, front] = controls.querySelectorAll('button');
    rotation.setAttribute('aria-label', 'Автовращение');
    back.textContent = 'Со спины';
    front.textContent = 'Спереди';
    tools.append(controls);
    setProduct(selected.id, colorIndex, pendingSide);
    if (location.hash === '#studio-fabric') inspectFabric();
  }, { once: true });
  window.addEventListener('bulbul3dpresented', showModel);
  window.addEventListener('bulbul3derror', showStatic);

  function loadViewer() {
    if (location.protocol === 'file:') {
      showStatic();
      return;
    }
    import(moduleURL.href).catch(showStatic);
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      loadViewer();
    }, { rootMargin: '480px' });
    observer.observe(board);
  } else {
    loadViewer();
  }
})();
