/* eslint-disable import/prefer-default-export, import/no-cycle */
import { getConfigValue } from './configs.js';

/* Common query fragments */

const priceFieldsFragment = `fragment priceFields on ProductViewPrice {
  regular {
      amount {
          currency
          value
      }
  }
  final {
      amount {
          currency
          value
      }
  }
}`;

/* Queries PDP */
export const refineProductQuery = `query RefineProductQuery($sku: String!, $variantIds: [String!]!) {
  refineProduct(
    sku: $sku,
    optionIds: $variantIds
  ) {
    images(roles: []) {
      url
      roles
      label
    }
    ... on SimpleProductView {
      price {
        final {
          amount {
            currency
            value
          }
        }
        regular {
          amount {
            currency
            value
          }
        }
      }
    }
    addToCartAllowed
  }
}`;

export const productDetailQuery = `query ProductQuery($sku: String!) {
  products(skus: [$sku]) {
    __typename
    id
    sku
    name
    description
    shortDescription
    urlKey
    inStock
    images(roles: []) {
      url
      label
      roles
    }
    attributes(roles: []) {
      name
      label
      value
      roles
    }
    ... on SimpleProductView {
      price {
        ...priceFields
      }
    }
    ... on ComplexProductView {
      options {
        id
        title
        required
        values {
          id
          title
          inStock
          ...on ProductViewOptionValueSwatch {
            type
            value
          }
        }
      }
      priceRange {
        maximum {
          ...priceFields
        }
        minimum {
          ...priceFields
        }
      }
    }
  }
}
${priceFieldsFragment}`;

/* Queries PLP */

export const productSearchQuery = `query ProductSearch(
  $currentPage: Int = 1
  $pageSize: Int = 20
  $phrase: String = ""
  $sort: [ProductSearchSortInput!] = []
  $filter: [SearchClauseInput!] = []
) {
  productSearch(
      current_page: $currentPage
      page_size: $pageSize
      phrase: $phrase
      sort: $sort
      filter: $filter
  ) {
      facets {
          title
          type
          attribute
          buckets {
              title
              __typename
              ... on RangeBucket {
                  count
                  from
                  to
              }
              ... on ScalarBucket {
                  count
                  id
              }
              ... on StatsBucket {
                  max
                  min
              }
          }
      }
      items {
          product {
            id
          }
          productView {
              name
              sku
              urlKey
              images(roles: "thumbnail") {
                url
              }
              __typename
              ... on SimpleProductView {
                  price {
                      ...priceFields
                  }
              }
              ... on ComplexProductView {
                  priceRange {
                      minimum {
                          ...priceFields
                      }
                      maximum {
                          ...priceFields
                      }
                  }
              }
          }
      }
      page_info {
          current_page
          total_pages
          page_size
      }
      total_count
  }
}
${priceFieldsFragment}`;

/* Common functionality */

export async function performCatalogServiceQuery(query, variables) {
  const headers = {
    'Content-Type': 'application/json',
    'Magento-Environment-Id': await getConfigValue('commerce-environment-id'),
    'Magento-Website-Code': await getConfigValue('commerce-website-code'),
    'Magento-Store-View-Code': await getConfigValue('commerce-store-view-code'),
    'Magento-Store-Code': await getConfigValue('commerce-store-code'),
    'Magento-Customer-Group': await getConfigValue('commerce-customer-group'),
    'x-api-key': await getConfigValue('commerce-x-api-key'),
  };

  const apiCall = new URL(await getConfigValue('commerce-endpoint'));
  apiCall.searchParams.append('query', query.replace(/(?:\r\n|\r|\n|\t|[\s]{4})/g, ' ')
    .replace(/\s\s+/g, ' '));
  apiCall.searchParams.append('variables', variables ? JSON.stringify(variables) : null);

  const response = await fetch(apiCall, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    return null;
  }

  const queryResponse = await response.json();

  return queryResponse.data;
}

export function renderPrice(product, format, html, Fragment) {
  // Simple product
  if (product.price) {
    const { regular, final } = product.price;
    if (regular.amount.value === final.amount.value) {
      return html`<span class="price-final">${format(final.amount.value)}</span>`;
    }
    return html`<${Fragment}>
      <span class="price-regular">${format(regular.amount.value)}</span> <span class="price-final">${format(final.amount.value)}</span>
    </${Fragment}>`;
  }

  // Complex product
  if (product.priceRange) {
    const { regular: regularMin, final: finalMin } = product.priceRange.minimum;
    const { final: finalMax } = product.priceRange.maximum;

    if (finalMin.amount.value !== finalMax.amount.value) {
      return html`
      <div class="price-range">
        <span class="price-from">${format(finalMin.amount.value)}</span><span class="price-from">${format(finalMax.amount.value)}</span>
        ${finalMin.amount.value !== regularMin.amount.value ? html`<span class="price-regular">${format(regularMin.amount.value)}</span>` : ''}
      </div>`;
    }

    if (finalMin.amount.value !== regularMin.amount.value) {
      return html`<${Fragment}>
      <span class="price-final">${format(finalMin.amount.value)}</span> <span class="price-regular">${format(regularMin.amount.value)}</span> 
    </${Fragment}>`;
    }

    return html`<span class="price-final">${format(finalMin.amount.value)}</span>`;
  }

  return null;
}

/* PDP specific functionality */

export function getSkuFromUrl() {
  const path = window.location.pathname;
  const result = path.match(/\/products\/[\w|-]+\/([\w|-]+)$/);
  return result?.[1];
}

const productsCache = {};
export async function getProduct(sku) {
  // eslint-disable-next-line no-param-reassign
  sku = sku.toUpperCase();
  if (productsCache[sku]) {
    return productsCache[sku];
  }
  const rawProductPromise = performCatalogServiceQuery(productDetailQuery, { sku });
  const productPromise = rawProductPromise.then((productData) => {
    if (!productData?.products?.[0]) {
      return null;
    }

    return productData?.products?.[0];
  });

  productsCache[sku] = productPromise;
  return productPromise;
}

/* PLP specific functionality */

// TODO
// You can get this list via attributeMetadata query
export const ALLOWED_FILTER_PARAMETERS = ['page', 'pageSize', 'sort', 'sortDirection', 'q', 'price', 'size', 'color_family'];

export async function loadCategory(state) {
  try {
    // TODO: Be careful if query exceeds GET size limits, then switch to POST
    const variables = {
      pageSize: state.currentPageSize,
      currentPage: state.currentPage,
      sort: [{
        attribute: state.sort,
        direction: state.sortDirection === 'desc' ? 'DESC' : 'ASC',
      }],
    };

    if (state.type === 'search') {
      variables.phrase = state.searchTerm;
    }

    if (Object.keys(state.filters).length > 0) {
      variables.filter = [];
      Object.keys(state.filters).forEach((key) => {
        if (key === 'price') {
          const [from, to] = state.filters[key];
          if (from && to) {
            variables.filter.push({ attribute: key, range: { from, to } });
          }
        } else if (state.filters[key].length > 1) {
          variables.filter.push({ attribute: key, in: state.filters[key] });
        } else if (state.filters[key].length === 1) {
          variables.filter.push({ attribute: key, eq: state.filters[key][0] });
        }
      });
    }

    if (state.type === 'category' && state.category.id) {
      variables.filter = variables.filter || [];
      variables.filter.push({ attribute: 'categoryIds', eq: state.category.id });
    }

    const response = await performCatalogServiceQuery(productSearchQuery, variables);

    // Parse response into state
    return {
      pages: Math.max(response.productSearch.page_info.total_pages, 1),
      products: {
        items: response.productSearch.items
          .map((product) => ({ ...product.productView, ...product.product }))
          .filter((product) => product !== null),
        total: response.productSearch.total_count,
      },
      facets: response.productSearch.facets.filter((facet) => facet.attribute !== 'categories'),
    };
  } catch (e) {
    console.error('Error loading products', e);
    return {
      pages: 1,
      products: {
        items: [],
        total: 0,
      },
      facets: [],
    };
  }
}

export function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const newState = {
    filters: {
      inStock: ['true'],
    },
  };
  params.forEach((value, key) => {
    if (!ALLOWED_FILTER_PARAMETERS.includes(key)) {
      return;
    }

    if (key === 'page') {
      newState.currentPage = parseInt(value, 10) || 1;
    } else if (key === 'pageSize') {
      newState.currentPageSize = parseInt(value, 10) || 10;
    } else if (key === 'sort') {
      newState.sort = value;
    } else if (key === 'sortDirection') {
      newState.sortDirection = value === 'desc' ? 'desc' : 'asc';
    } else if (key === 'q') {
      newState.searchTerm = value;
    } else if (key === 'price') {
      newState.filters[key] = value.split(',').map((v) => parseInt(v, 10) || 0);
    } else {
      newState.filters[key] = value.split(',');
    }
  });
  return newState;
}

export function setJsonLd(data, name) {
  const existingScript = document.head.querySelector(`script[data-name="${name}"]`);
  if (existingScript) {
    existingScript.innerHTML = JSON.stringify(data);
    return;
  }

  const script = document.createElement('script');
  script.type = 'application/ld+json';

  script.innerHTML = JSON.stringify(data);
  script.dataset.name = name;
  document.head.appendChild(script);
}
