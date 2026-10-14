const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const convert = require('xml-js');
const pool = require("../database/db.js");

const parser = new xml2js.Parser({
  explicitArray: false,  // This option prevents wrapping single values in arrays
});

let date_ob = new Date();
router.post('/', async (request, response) => {

    let date_ob = new Date();
    let date = ("0" + date_ob.getDate()).slice(-2); let month = ("0" + (date_ob.getMonth() + 1)).slice(-2); let year = date_ob.getFullYear();

  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  // Check if request.body is an object
  if (typeof request.body === 'object') {
    xmlString = request.body.xmlData;
    if (!xmlString) {
      return res.status(400).send('XML data not found in the request.');
    }
  } else {
    // If request.body is a string, use it directly
    xmlString = request.body;
  }

  // Ensure xmlString is a string and trim it
  if (typeof xmlString !== 'string') {
    xmlString = xmlString.toString();
  }

  
  xmlString = xmlString.trim();
 
  const folderPath = './XMLS';
   const fileName = 'TransportationOrderGenericRequest_' + date_ob.getFullYear() + date_ob.getMonth()+ date_ob.getDate() + '.xml'; //+ date_ob.getHours()+ date_ob.getMinutes() + date_ob.getSeconds() + date_ob.getMilliseconds() + 
    const filePath = `${folderPath}/${fileName}`;
    fs.writeFile(filePath, (xmlString), (err) => {
      if (err) {
        console.error('Error saving request:', err);
        response.send('Error saving request:').status(200);
      } else {
        console.log('Request saved successfully.');
        response.send('Request saved successfully.').status(200);
      }
    });
    
});



module.exports = router;
