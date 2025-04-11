const pokemonGridElement = document.querySelector('#pokemon-grid');
const initialLoadingIndicator = document.querySelector('#loading-initial');
const moreLoadingIndicator = document.querySelector('#loading-more');
const themeToggleButton = document.querySelector('#theme-toggle-button');
const modalElement = document.querySelector('#pokemon-modal');
const modalContentElement = modalElement.querySelector('#modal-pokemon-details');
const modalCloseButtons = modalElement.querySelectorAll('[data-close-modal]');
const bodyElement = document.body;
const searchInputElement = document.querySelector('#search-input');
const noResultsMessageElement = document.querySelector('#no-results-message');
const infiniteScrollTrigger = document.querySelector('#infinite-scroll-trigger');


const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2/';
const POKEMON_LIST_LIMIT = 5000;
const ITEMS_PER_PAGE = 30;
const PLACEHOLDER_IMAGE_URL = '/public/question-mark.svg'; 

let isDarkMode = false;
let allPokemonList = [];     
let activePokemonList = [];
let currentOffset = 0;
let isLoading = false;
let isSearchActive = false;
let currentSearchTerm = '';
let hasMorePokemon = true;
let pokemonDetailsCache = new Map();
let observer;


function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
}


function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}


async function fetchData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.text();
            console.error(`HTTP error! Status: ${response.status}, URL: ${url}, Body: ${errorData}`);
            throw new Error(`Network response was not ok: ${response.statusText} (status: ${response.status})`);
        }
        if (response.headers.get('content-length') === '0') return null;
        return await response.json();
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error);
        return null;
    }
}


async function fetchPokemonList() {
    const listUrl = `${POKEAPI_BASE_URL}pokemon?limit=${POKEMON_LIST_LIMIT}&offset=0`;
    console.log(`Fetching initial list: ${listUrl}`);
    const listData = await fetchData(listUrl);
    if (listData && listData.results) {
        allPokemonList = listData.results;
        activePokemonList = allPokemonList;
        hasMorePokemon = allPokemonList.length > 0;
        console.log(`Fetched ${allPokemonList.length} Pokémon names/URLs.`);
    } else {
        displayGridError('Не удалось загрузить основной список покемонов.');
        allPokemonList = [];
        activePokemonList = [];
        hasMorePokemon = false;
    }
}


async function fetchBatchDetails(pokemonRefs) {
    const promises = pokemonRefs.map(async (pokemonRef) => {
        if (pokemonDetailsCache.has(pokemonRef.url)) {
            const cachedData = pokemonDetailsCache.get(pokemonRef.url);
            return {
                 name: cachedData.name,
                 url: pokemonRef.url,
                 sprites: cachedData.sprites
             };
        }
        const details = await fetchData(pokemonRef.url);
        if (details) {
            pokemonDetailsCache.set(pokemonRef.url, details);
            return {
                name: details.name,
                url: pokemonRef.url,
                sprites: details.sprites,
            };
        }
        console.warn(`Failed to fetch details for ${pokemonRef.name || pokemonRef.url}`);
        return null;
    });

    const results = await Promise.allSettled(promises);
    return results
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value);
}

function createPokemonTileElement(pokemonData) {
    const tile = document.createElement('div');
    tile.classList.add('pokemon-tile');
    tile.dataset.url = pokemonData.url;
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');

    const pokemonName = capitalizeFirstLetter(pokemonData.name);
    const imageUrl = pokemonData.sprites?.front_default;

    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = pokemonName;
        img.width = 80;
        img.height = 80;
        img.loading = 'lazy';
        img.onerror = (e) => {
             console.warn(`Sprite failed to load for ${pokemonName}: ${imageUrl}`);
             const placeholder = document.createElement('div');
             placeholder.classList.add('placeholder-sprite');
             placeholder.textContent = '?';
             placeholder.setAttribute('aria-label', 'Изображение недоступно');
             if (e.target.parentNode === tile) tile.replaceChild(placeholder, e.target);
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

function appendPokemonTiles(pokemonDataList) {
    if (!pokemonDataList || pokemonDataList.length === 0) return;

    const fragment = document.createDocumentFragment();
    pokemonDataList.forEach(pokemonData => {
        if (pokemonData && pokemonData.name && pokemonData.url) {
            const tileElement = createPokemonTileElement(pokemonData);
            fragment.appendChild(tileElement);
        } else {
            console.warn("Invalid pokemonData encountered in appendPokemonTiles:", pokemonData);
        }
    });

    if (fragment.children.length > 0) {
        pokemonGridElement.appendChild(fragment);
        noResultsMessageElement.style.display = 'none';
    }
}

function displayInfoMessage(message, isError = false) {
     initialLoadingIndicator.style.display = 'none';
     moreLoadingIndicator.style.display = 'none';
     pokemonGridElement.innerHTML = '';
     noResultsMessageElement.textContent = message;
     noResultsMessageElement.style.color = isError ? 'var(--accent-color)' : 'var(--text-color)'; 
     noResultsMessageElement.style.display = 'block';
}

async function loadMorePokemon() {
    if (isLoading || !hasMorePokemon) {
        console.log(`Load skipped: isLoading=${isLoading}, hasMorePokemon=${hasMorePokemon}`);
        return;
    }

    isLoading = true;
    moreLoadingIndicator.style.display = 'flex';
    const batchToLoad = activePokemonList.slice(currentOffset, currentOffset + ITEMS_PER_PAGE);
    console.log(`Loading batch: offset=${currentOffset}, size=${batchToLoad.length}, activeListSize=${activePokemonList.length}`);

    if (batchToLoad.length === 0) {
        hasMorePokemon = false;
        moreLoadingIndicator.style.display = 'none';
        isLoading = false;
        if (pokemonGridElement.children.length === 0) {
             const message = isSearchActive
                ? `Покемоны по запросу "${currentSearchTerm}" не найдены.`
                : 'Нет покемонов для отображения.';
             displayInfoMessage(message);
        }
        console.log("No more Pokémon to load from active list.");
        return;
    }

    const pokemonDetails = await fetchBatchDetails(batchToLoad);
    appendPokemonTiles(pokemonDetails);

    currentOffset += batchToLoad.length;
    hasMorePokemon = currentOffset < activePokemonList.length;

    moreLoadingIndicator.style.display = 'none';
    isLoading = false;

    if (!hasMorePokemon) {
         console.log("Reached the end of the active Pokémon list.");
    }
}

function setupIntersectionObserver() {
    const options = { root: null, rootMargin: '100px', threshold: 0 };

    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMorePokemon && !isLoading) {
            console.log("Intersection observer triggered: Loading more Pokémon...");
            loadMorePokemon();
        }
    }, options);

    observer.observe(infiniteScrollTrigger);
}

function startSearch(searchTerm) {
    if (isSearchActive && currentSearchTerm === searchTerm) {
        return;
    }

    console.log(`Starting search for: "${searchTerm}"`);
    isSearchActive = true;
    currentSearchTerm = searchTerm;
    isLoading = false;
    pokemonGridElement.innerHTML = '';
    noResultsMessageElement.style.display = 'none';
    moreLoadingIndicator.style.display = 'none';

    const filteredList = allPokemonList.filter(pokemon =>
        pokemon.name.toLowerCase().includes(searchTerm)
    );

    activePokemonList = filteredList;
    currentOffset = 0;
    hasMorePokemon = activePokemonList.length > 0;

    console.log(`Filtered list size: ${activePokemonList.length}`);

    if (hasMorePokemon) {
        loadMorePokemon();
        if (observer) observer.observe(infiniteScrollTrigger);
    } else {
        displayInfoMessage(`Покемоны по запросу "${searchTerm}" не найдены.`);
        if (observer) observer.unobserve(infiniteScrollTrigger);
    }
}


function clearSearch() {
    if (!isSearchActive && searchInputElement.value === '') return;

    console.log("Clearing search results.");
    isSearchActive = false;
    currentSearchTerm = '';
    searchInputElement.value = '';
    isLoading = false;
    pokemonGridElement.innerHTML = '';
    noResultsMessageElement.style.display = 'none';
    moreLoadingIndicator.style.display = 'none';

    activePokemonList = allPokemonList;
    currentOffset = 0;
    hasMorePokemon = activePokemonList.length > 0;

    if (hasMorePokemon) {
        loadMorePokemon();
        if (observer) observer.observe(infiniteScrollTrigger);
    } else {
        displayInfoMessage('Нет покемонов для отображения.');
        if (observer) observer.unobserve(infiniteScrollTrigger);
    }
}

const debouncedSearchHandler = debounce((term) => {
    if (term === '') {
        clearSearch();
    } else {
        startSearch(term);
    }
}, 350);

function handleSearchInput() {
    requestAnimationFrame(() => {
         const searchTerm = searchInputElement.value.trim().toLowerCase();
         debouncedSearchHandler(searchTerm);
    });
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

function displayModalError(message) {
     modalContentElement.innerHTML = `<p class="error-message" style="padding: 2rem; text-align: center; color: var(--accent-color);">${message}</p>`;
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
            } else {
                 bar.style.width = '0%';
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
    const imageUrl = sprites?.other?.['official-artwork']?.front_default || sprites?.front_default || PLACEHOLDER_IMAGE_URL;
    const typesString = types?.map(typeInfo => capitalizeFirstLetter(typeInfo.type.name)).join(', ') || 'Неизвестен';
    const statsListHtml = stats?.map(statInfo => {
        let statName = statInfo.stat.name.replace('-', ' ');
        if (statName === 'special attack') statName = 'Sp. Attack';
        if (statName === 'special defense') statName = 'Sp. Defense';
        statName = capitalizeFirstLetter(statName);
        const statValue = statInfo.base_stat;
        return `
            <li>
                <span class="stat-name">${statName}</span>
                <div class="stat-bar"><div class="stat-bar-inner" data-stat-value="${statValue}" style="width: 0%;"></div></div>
                <strong class="stat-value">${statValue}</strong>
            </li>`;
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
        <ul class="stats-list">${statsListHtml}</ul>`;
    animateStatBars();
}

async function handlePokemonTileClick(event) {
    const tile = event.currentTarget;
    const pokemonUrl = tile.dataset.url;
    if (!pokemonUrl) {
        console.error("Missing data-url attribute on Pokémon tile:", tile);
        displayModalError("Не удалось определить URL покемона.");
        openModal();
        return;
    }

    resetModalContent();
    openModal();

    let pokemonData = pokemonDetailsCache.get(pokemonUrl);

    if (!pokemonData) {
        console.log(`Cache miss for ${pokemonUrl}, fetching full details...`);
        pokemonData = await fetchData(pokemonUrl);
        if (pokemonData) {
            pokemonDetailsCache.set(pokemonUrl, pokemonData);
        }
    } else {
         console.log(`Cache hit for ${pokemonUrl}`);
    }

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
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    isDarkMode = savedTheme === 'dark' || (!savedTheme && prefersDark);
    bodyElement.classList.toggle('dark-theme', isDarkMode);
    themeToggleButton.textContent = isDarkMode ? '🌙' : '☀️';
    themeToggleButton.setAttribute('aria-label', isDarkMode ? 'Включить светлую тему' : 'Включить темную тему');
}


async function initializeApp() {
    initialLoadingIndicator.style.display = 'flex';

    loadThemePreference();
    themeToggleButton.addEventListener('click', toggleTheme);
    modalCloseButtons.forEach(button => button.addEventListener('click', closeModal));
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalElement.classList.contains('active')) closeModal();
    });
    searchInputElement.addEventListener('input', handleSearchInput);


    await fetchPokemonList();

    initialLoadingIndicator.style.display = 'none';

    if (hasMorePokemon) {
        loadMorePokemon();
        setupIntersectionObserver();
    } else {
         console.error("Initialization complete, but no Pokémon could be loaded initially.");
    }
}

initializeApp();