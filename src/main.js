const pokemonGridElement = document.querySelector('#pokemon-grid');
const loadingIndicator = document.querySelector('#loading-list');
const themeToggleButton = document.querySelector('#theme-toggle-button');
const modalElement = document.querySelector('#pokemon-modal');
const modalContentElement = modalElement.querySelector('#modal-pokemon-details');
const modalCloseButtons = modalElement.querySelectorAll('[data-close-modal]');
const bodyElement = document.body;


const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2/';
const POKEMON_LIST_LIMIT = 500;
const PLACEHOLDER_IMAGE_URL = '/public/question-mark.svg';

let isDarkMode = false;

function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
}

async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.text();
            console.error(`HTTP error! Status: ${response.status}, Body: ${errorData}`);
            throw new Error(`Network response was not ok: ${response.statusText} (status: ${response.status})`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error);
        return null;
    }
}

function openModal() {
    bodyElement.style.overflow = 'hidden';
    modalElement.classList.add('active');
    modalElement.setAttribute('aria-hidden', 'false');
    modalContentElement.addEventListener('transitionend', () => {
         modalElement.querySelector('.modal-close-btn')?.focus();
    }, { once: true });
}

function closeModal() {
    bodyElement.style.overflow = '';
    modalElement.classList.remove('active');
    modalElement.setAttribute('aria-hidden', 'true');
    modalContentElement.addEventListener('transitionend', resetModalContent, { once: true });
}

function resetModalContent() {
     modalContentElement.innerHTML = `
        <div class="loading-indicator modal-loading">
            <div class="spinner"></div>
            <span>Загрузка деталей...</span>
        </div>`;
     modalContentElement.removeEventListener('transitionend', resetModalContent);
}

function displayGridError(message) {
     pokemonGridElement.innerHTML = `<p class="error-message">${message}</p>`;
     const errorMsg = pokemonGridElement.querySelector('.error-message');
     if(errorMsg) {
         errorMsg.style.gridColumn = '1 / -1';
         errorMsg.style.textAlign = 'center';
         errorMsg.style.padding = '2rem';
         errorMsg.style.color = 'var(--accent-color)';
     }
}
function displayModalError(message) {
     modalContentElement.innerHTML = `<p class="error-message">${message}</p>`;
      const errorMsg = modalContentElement.querySelector('.error-message');
     if(errorMsg) {
         errorMsg.style.padding = '2rem';
         errorMsg.style.color = 'var(--accent-color)';
     }
}


function animateStatBars() {
    requestAnimationFrame(() => {
        const statBars = modalContentElement.querySelectorAll('.stat-bar-inner');
        statBars.forEach(bar => {
            const targetWidth = bar.getAttribute('data-stat-value');
            if (targetWidth) {
                const maxWidth = 200;
                const percentage = Math.min((parseInt(targetWidth, 10) / maxWidth) * 100, 100);
                bar.style.width = `${percentage}%`;
            }
        });
    });
}

function populateModal(pokemonData) {
    if (!pokemonData) {
         displayModalError('Не удалось загрузить детали покемона.');
         return;
    }

    const { name, sprites, types, height, weight, stats } = pokemonData;

    const imageUrl = sprites?.front_default || PLACEHOLDER_IMAGE_URL;
    const typesString = types?.map(typeInfo => capitalizeFirstLetter(typeInfo.type.name)).join(', ') || 'Неизвестен';

    const statsListHtml = stats?.map(statInfo => {
        const statName = capitalizeFirstLetter(statInfo.stat.name.replace('-', ' '));
        const statValue = statInfo.base_stat;
        return `
            <li>
                <span class="stat-name">${statName}</span>
                <div class="stat-bar">
                    <div class="stat-bar-inner" data-stat-value="${statValue}" style="width: 0%;"></div>
                </div>
                <strong class="stat-value">${statValue}</strong>
            </li>
        `;
    }).join('') || '<li>Статистика недоступна</li>';

    modalContentElement.innerHTML = `
        <h3>${capitalizeFirstLetter(name)}</h3>
        <img src="${imageUrl}" alt="${capitalizeFirstLetter(name)}" width="140" height="140" loading="lazy">

        <div class="pokemon-meta">
            <p><strong>Тип(ы):</strong> ${typesString}</p>
            <p><strong>Рост:</strong> ${height ? height / 10 + ' м' : 'Неизвестен'}</p>
            <p><strong>Вес:</strong> ${weight ? weight / 10 + ' кг' : 'Неизвестен'}</p>
        </div>

        <h4>Базовые статы:</h4>
        <ul class="stats-list">${statsListHtml}</ul>
    `;

    animateStatBars();
}

function createPokemonTileElement(pokemon, details) {
    const tile = document.createElement('div');
    tile.classList.add('pokemon-tile');
    tile.dataset.url = pokemon.url;
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');

    const pokemonName = capitalizeFirstLetter(pokemon.name);
    const imageUrl = details?.sprites?.front_default;

    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = pokemonName;
        img.loading = 'lazy';
        img.onerror = (e) => {
             console.warn(`Failed to load sprite for ${pokemonName}: ${imageUrl}`);
             const placeholder = document.createElement('div');
             placeholder.classList.add('placeholder-sprite');
             placeholder.textContent = '?';
             placeholder.setAttribute('aria-label', 'Изображение недоступно');
             if (e.target.parentNode === tile) {
                tile.replaceChild(placeholder, e.target);
             }
        };
        tile.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.classList.add('placeholder-sprite');
        placeholder.textContent = '?';
        placeholder.setAttribute('aria-label', 'Изображение недоступно');
        tile.appendChild(placeholder);
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = pokemonName;
    tile.appendChild(nameSpan);

    tile.addEventListener('click', handlePokemonTileClick);
    tile.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handlePokemonTileClick(event);
        }
    });

    return tile;
}


async function loadAndDisplayPokemonGrid() {
    loadingIndicator.style.display = 'flex';
    pokemonGridElement.innerHTML = '';

    const listUrl = `${POKEAPI_BASE_URL}pokemon?limit=${POKEMON_LIST_LIMIT}&offset=0`;
    const listData = await fetchData(listUrl);

    if (!listData || !listData.results) {
        loadingIndicator.style.display = 'none';
        displayGridError('Не удалось загрузить список покемонов. Проверьте консоль или обновите страницу.');
        return;
    }

    const detailPromises = listData.results.map(pokemon => fetchData(pokemon.url).then(data => ({
        name: pokemon.name,
        url: pokemon.url,
        sprites: data?.sprites
    })));

    const tileDataResults = await Promise.allSettled(detailPromises);

    loadingIndicator.style.display = 'none';

    let hasTiles = false;

    tileDataResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            const tileElement = createPokemonTileElement(result.value, result.value);
            pokemonGridElement.appendChild(tileElement);
            hasTiles = true;
        } else {
             console.error(`Failed to process data for a Pokémon: ${result.reason || 'Unknown error'}`);
        }
    });

    if (!hasTiles && listData.results.length > 0) {
         displayGridError('Не удалось загрузить данные для отображения покемонов.');
    }
}

async function handlePokemonTileClick(event) {
    const tile = event.currentTarget;
    const pokemonUrl = tile.dataset.url;

    if (!pokemonUrl) {
        console.error("No pokemon URL found on the tile:", tile);
        return;
    }

    resetModalContent();
    openModal();

    const pokemonData = await fetchData(pokemonUrl);
    populateModal(pokemonData);
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    bodyElement.classList.toggle('dark-theme', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    themeToggleButton.textContent = isDarkMode ? '🌙' : '☀️';
    themeToggleButton.setAttribute('aria-label', isDarkMode ? 'Включить светлую тему' : 'Включить темную тему');
}

function loadThemePreference() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        isDarkMode = true;
    } else {
        isDarkMode = false;
    }

    bodyElement.classList.toggle('dark-theme', isDarkMode);
    themeToggleButton.textContent = isDarkMode ? '🌙' : '☀️';
    themeToggleButton.setAttribute('aria-label', isDarkMode ? 'Включить светлую тему' : 'Включить темную тему');
}

function initializeApp() {
    themeToggleButton.addEventListener('click', toggleTheme);

    modalCloseButtons.forEach(button => {
        button.addEventListener('click', closeModal);
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalElement.classList.contains('active')) {
            closeModal();
        }
    });

    loadThemePreference();
    loadAndDisplayPokemonGrid();
}

initializeApp();