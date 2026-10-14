const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');

router.post('/', async (request,response)=>{
    let date_ob = new Date();
    let date = ("0" + date_ob.getDate()).slice(-2);
    let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
    let year = date_ob.getFullYear();
var tokenurl ='https://wwwcie.ups.com/security/v1/oauth/token'
var trackurl ='https://wwwcie.ups.com/api/track/v1/details/'

 

 //console.log(shipmentidentificationnumber)
// console.log(Voidrequest)
 var version ='v1'
   
 const filePath = 'D:\SAP\CARRIER DETAILS\ShipmentService\predefined.json';
 

//  fs.readFile(filePath, 'utf8', (err, data) => {
//     if (err) {
//       console.error('Error reading the JSON file:', err);
//       return;
//     }
  
//     const jsonData = JSON.parse(data);
//     // Now jsonData contains the content of the JSON file as a JavaScript object.
//     // You can access and modify its properties.

//     // Assume jsonData is the parsed JSON data from the file.
// jsonData.newProperty = 'New Value'; // Add a new property
// jsonData.existingProperty = 'Updated Value'; // Update an existing property
// delete jsonData.propertyToDelete; // Delete a property
//   });


    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    
    const input = `grant_type=client_credentials`;
    const tdata = await axios.post(tokenurl, input, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${request.body.CARRIER_DETAILS.USERID}:${request.body.CARRIER_DETAILS.PASSWORD}`).toString('base64')
          },
    })
    .catch((ex) => {
      console.log('----------------------------------------------token Exception is...: ')
      console.log(ex.response.data)
      finalResponse = {};
      request.body['status'] = 'Error';
      request.body['Errors'] = [];
      ex.response.data.response.errors.forEach((er) => { request.body.Errors.push(er.message);console.log(er.message) });
      response.send(request.body).status(ex.response.status);
  })

axios.get(trackurl + request.body.PACKAGES[0]?.TRACKING_NUMBER,
        {
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer ' + tdata.data.access_token,
              'transId': '1 ' + request.body.HEADER_INFO.DOCUMENT_NUMBER,
              'transactionSrc': 'testing' 
            },
        },
    ).then((avres) => {
        console.log('UPS Track Response is ..:');
        console.log(avres.data)
        // const fileName = 'UPSTrackResponse.txt';
        // const filePath = `${folderPath}/${fileName}`;
        // fs.writeFile(filePath, JSON.stringify(avres.data), (err) => {
        //     if (err) {
        //       console.error('Error saving request:', err);
        //     } else {
        //       console.log('Request saved successfully.');
        //     }
        //   });
         

    response.send(avres.data).status(200);

   })
   .catch((ex) => {
    console.log('----------------------------------Exception is...: ')
    console.log(ex.response)
    finalResponse = {};
    request.body['status'] = 'Error';
    request.body['Errors'] = [];
  //  ex.response.data.response.errors.forEach((er) => { request.body.Errors.push(er.message);console.log(er.message) });
    response.send(request.body).status(ex.response.status);
})
  //  response.send('working').status(ex.response.status);
});

module.exports = router;