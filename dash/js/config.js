/* KalshiDash1 — configuration. All endpoints verified against docs.kalshi.com (see api.html). */
window.KALSHI_CONFIG = {
  endpoints: {
    primary: 'https://external-api.demo.kalshi.co/trade-api/v2',
    legacy: 'https://demo-api.kalshi.co/trade-api/v2',
    wsPrimary: 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2',
    wsLegacy: 'wss://demo-api.kalshi.co/trade-api/ws/v2',
    web: 'https://demo.kalshi.co'
  },
  docs: {
    environments: 'https://docs.kalshi.com/getting_started/api_environments',
    demoEnv: 'https://docs.kalshi.com/getting_started/demo_env',
    marketData: 'https://docs.kalshi.com/getting_started/quick_start_market_data',
    orderbook: 'https://docs.kalshi.com/getting_started/orderbook_responses',
    auth: 'https://docs.kalshi.com/getting_started/quick_start_authenticated_requests',
    apiKeys: 'https://docs.kalshi.com/getting_started/api_keys',
    rateLimits: 'https://docs.kalshi.com/getting_started/rate_limits',
    settlement: 'https://docs.kalshi.com/getting_started/market_settlement',
    lifecycle: 'https://docs.kalshi.com/getting_started/market_lifecycle',
    fixedPoint: 'https://docs.kalshi.com/getting_started/fixed_point_migration',
    candlesticks: 'https://docs.kalshi.com/api-reference/market/get-market-candlesticks',
    getMarkets: 'https://docs.kalshi.com/api-reference/market/get-markets',
    getMarket: 'https://docs.kalshi.com/api-reference/market/get-market',
    getOrderbook: 'https://docs.kalshi.com/api-reference/market/get-market-orderbook',
    getEvents: 'https://docs.kalshi.com/api-reference/events/get-events',
    getSeries: 'https://docs.kalshi.com/api-reference/market/get-series-list',
    createOrder: 'https://docs.kalshi.com/api-reference/orders/create-order-v2',
    getTrades: 'https://docs.kalshi.com/api-reference/market/get-trades',
    getPositions: 'https://docs.kalshi.com/api-reference/portfolio/get-positions',
    getBalance: 'https://docs.kalshi.com/api-reference/portfolio/get-balance',
    getFills: 'https://docs.kalshi.com/api-reference/portfolio/get-fills',
    getSettlements: 'https://docs.kalshi.com/api-reference/portfolio/get-settlements',
    historical: 'https://docs.kalshi.com/getting_started/historical_data',
    glossary: 'https://docs.kalshi.com/getting_started/terms'
  },
  /* Focus topics. Category/tag filters are exact, case-sensitive per docs (Get Series List). */
  topics: [
    {
      id: 'gas', label: 'Gas Prices',
      seriesQueries: [
        '/series?category=Economics&tags=Oil%20and%20energy&include_volume=true&limit=50',
        '/series?category=Economics&limit=50'
      ],
      titleMatch: /\bgas\b|gasoline|fuel price|SPR\b/i,
      tickerMatch: /GAS|SPR/i
    },
    {
      id: 'elections', label: 'Elections',
      seriesQueries: ['/series?category=Elections&include_volume=true&limit=50'],
      titleMatch: /elect|senate|house|president|mayor|governor|speaker|vote|pope|nato|primary/i,
      tickerMatch: /ELECT|SENATE|HOUSE|PRES|MAYOR|GOV|SPEAKER|VOTE|POPE|NATO|PRIMARY|POTUS/i
    },
    {
      id: 'culture', label: 'Culture',
      seriesQueries: ['/series?category=Culture&limit=50'],
      titleMatch: /ban|culture|oscar|grammy|movie|music|celebrity|banned/i,
      tickerMatch: /BANNED|CULTURE|OSCAR|GRAMMY|RTCOMPARISON/i
    },
    {
      id: 'crypto', label: 'Crypto',
      seriesQueries: ['/series?category=Crypto&limit=50'],
      titleMatch: /bitcoin|btc|ethereum|eth|xrp|ripple|crypto|solana|doge|bnb/i,
      tickerMatch: /BTC|ETH|XRP|CRYPTO|RIPPLE|BNB|SOL|DOGE|DEMOFUT/i
    },
    {
      id: 'golf', label: 'Golf',
      seriesQueries: ['/series?category=Sports&tags=Golf&include_volume=true&limit=50'],
      titleMatch: /golf|pga|tour|cut line|under par|birdie|eagle|round \d/i,
      tickerMatch: /GOLF|PGA|TGL|CHAMPTOUR/i
    }
  ],
  chartWindows: [
    { id: '5m', label: '5 min (sec)', seconds: 300 },
    { id: '1h', label: '1 hour', seconds: 3600 },
    { id: '6h', label: '6 hours', seconds: 21600 },
    { id: '24h', label: '24 hours', seconds: 86400 },
    { id: '7d', label: '7 days', seconds: 604800 }
  ],
  polling: {
    listRefreshMs: 120000,   /* topic list refresh when live (unauth rate limits: be polite) */
    marketRefreshMs: 10000,  /* selected market: price + orderbook */
    historyRefreshMs: 60000  /* candlesticks backfill */
  }
};
