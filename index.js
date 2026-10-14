const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocs = require('./swagger');
const bodyParser = require('body-parser');
require('body-parser-xml')(bodyParser);

require('dotenv').config();

const app = express();

/* =====================================================
   GLOBAL MIDDLEWARE
===================================================== */

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS']
}));

// 1️⃣ Required for SAP TM sending raw XML
app.use(express.text({
  type: ['application/xml', 'text/xml', 'application/*+xml']
}));

// 2️⃣ Parse XML
app.use(bodyParser.xml({
  limit: '1MB',
  xmlParseOptions: {
    normalize: true,
    explicitArray: false
  }
}));

// 3️⃣ JSON & URL encoded
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/* =====================================================
   NEW UNIFIED CARRIER API (IMPORTANT)
===================================================== */
//app.use('/api/addressvalidation', require('./carriers/fedex/addressvalidation'));
app.use('/api/getshipdata', require("./routes/getshipdata.route"));
app.use('/api/addressvalidation', require('./routes/addressvalidate.route'));
app.use('/api/return', require('./routes/return.route'));

app.use('/api/ship', require('./routes/ship.route'));
app.use('/api/ipdMaster', require('./carriers/fedex/ipdmaster'));
app.use('/api/ipdChild', require('./carriers/fedex/ipdchild'));
app.use('/api/ipdClose', require('./carriers/fedex/ipdclose'));

app.use('/api/void', require('./routes/void.route'));
app.use('/api/track', require('./routes/track.route'));
//app.use('/api/rate', require('./routes/rate.route'));
app.use('/api/rateall', require('./routes/rateAll.route'));


/* =====================================================
   GLOBAL ERROR HANDLER (IMPORTANT FOR CLOUD)
===================================================== */

app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.statusCode || 500).json({
    status: 'Error',
    message: err.message || 'Internal Server Error'
  });
});

/* =====================================================
   SERVER START
===================================================== */

const port = process.env.PORT || 5001;

app.listen(port, () => {
  console.log(`🚀 Shipment Service running on port ${port}`);
});



// index.js
// /routes
//    ship.route.js
//    void.route.js
// /controllers
//    ship.controller.js
//    void.controller.js
// /factories
//    carrier.factory.js
// /carriers
//    /fedex
//    /ups
//    /dhl
//    ...100+


// Inside any async carrier module:
// ❌ NEVER use .then()    ❌ NEVER mix await + then  ❌ NEVER forget return


// || returns the first truthy value.--> undefined,null,"" (empty string),0,false,NaN
// ?? use it ONLY want to fallback when it is:null, undefined,