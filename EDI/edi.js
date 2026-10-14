const express = require('express');
const router = express.Router();
const fs = require('fs');
const ftp = require('ftp');

router.post('/', async (request, response) => {
  let date_ob = new Date();   
  let date = ("0" + date_ob.getDate()).slice(-2);    let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);    let year = date_ob.getFullYear();
  let hours = ('0' + date_ob.getHours()).slice(-2);
  let minutes = ('0' + date_ob.getMinutes()).slice(-2);
  try 
    {
      class StringBuilder {
        constructor() {
          this.strings = [];
        }
      
        append(str) {
          this.strings.push(str + '\n');
          return this;
        }
       
        toString() {
          return this.strings.join('');
        }
      }
     
var strISAReceiverID ='', strEnvironment ='', strSeparator='', strSeparator='', strEDIWeightUOM='', strGSReceiverID='', strEDIVolumeUOM='' ;
var strControlerNo ='', iTotalWeight ='', iTotalPackageVolume='', strCompanyEDIID='',ConsolidatedID='',SCACCode='',ModeOfTransport='',ServiceLevelCode='';
var dtCargoReadyDate = `${year}${month}${date}`,BOLAWBTrackingNo='',ITN='',SpecialInstructions='',PaymentCode='',NoOfPieces=0;
var HL02 ='',RoutingServiceCode='',TD5IdentificationCode='',DTMQualifier='';

      let stringBuilder = new StringBuilder();
         
      stringBuilder.append("ISA*00*          *00*          *ZZ*" + padRight(strCompanyEDIID,15,' ') + "*ZZ*" + (padRight(strISAReceiverID,15,' ')) + "*" +  `${year}${month}${date}` +  "*" +  `${hours}${minutes}` +  "*U*00401*" +  (strControlerNo) +  "*0*" +  (strEnvironment) +  "*" +  (strSeparator) +  "|")
      stringBuilder.append("GS*SH*" + (strCompanyEDIID) + "*" + (strGSReceiverID) + "*" +  `${year}${month}${date}` +  "*" +  `${hours}${minutes}` +  "*" +  (strControlerNo) +  "*X*004010" +  "|")
      stringBuilder.append("ST*856*" + (strControlerNo) + "|")
            stringBuilder.append("BSN*00*" + (ConsolidatedID) + "*" +  `${year}${month}${date}` +  "*" +  `${hours}${minutes}` +  "|")
            stringBuilder.append("HL*1*" + HL02 + "*S" + "|")
            stringBuilder.append("HL*1*0*S" + "|")
            stringBuilder.append("TD1*PCS*" + NoOfPieces + "****G*" + iTotalWeight + "*" + (strEDIWeightUOM) + "*" + Math.round(iTotalPackageVolume) + "*" + (strEDIVolumeUOM) + "|")
            stringBuilder.append("TD5*" + RoutingServiceCode + "*" + TD5IdentificationCode + "*" + setStringMaximum((SCACCode), 80) + "*" + ModeOfTransport + "********" + (ServiceLevelCode) + "|")
            stringBuilder.append("REF*ZZ*" + setStringMaximum((request.body.CARRIER_DETAILS.REFERENCE1), 30) + "|")
             stringBuilder.append("REF*ITN*" + setStringMaximum((request.body.CARRIER_DETAILS.Reference4), 30) + "|")
             stringBuilder.append("REF*L1*Shipping Instructions*" + setStringMaximum((request.body.CARRIER_DETAILS.REFERENCE2), 80) + "|")
             stringBuilder.append("REF*2I*" + setStringMaximum((request.body.CARRIER_DETAILS.REFERENCE3), 30) + "|")
            // stringBuilder.append("REF*TC*" + setStringMaximum((IncoTerm), 30) + "|")
            // stringBuilder.append("REF*5T*" + setStringMaximum((INTL_Duties_Taxes), 30) + "|")
            // stringBuilder.append("REF*91*" + setStringMaximum((CustomsValue), 30) + "|")
            // stringBuilder.append("REF*4C*" + setStringMaximum((Reference2), 30) + "|")
            // stringBuilder.append("REF*PD*" + setStringMaximum(((PortOfDeparture)), 80) + "|")
            // stringBuilder.append("REF*PB*" + setStringMaximum(((PreBookingFlag)), 80) + "|")
            // stringBuilder.append("REF*ST*" + setStringMaximum(((AirOceanIndicator)), 80) + "|")
            // stringBuilder.append("REF*CN*" + setStringMaximum((ProductDesc), 80) + "|")
            // stringBuilder.append("REF*BN*" + setStringMaximum((BookingNo), 80) + "|")
            // stringBuilder.append("REF*4H*" + setStringMaximum((CommeInvoice), 30) + "|")
            // stringBuilder.append("REF*08*" + setStringMaximum((PackagingMaterial), 30) + "|")
            // stringBuilder.append("REF*ZZ*" + setStringMaximum((DryIceWeight), 30) + "*" + setStringMaximum((DryIceWeightUOM), 80) + "|")
            // stringBuilder.append("REF*AHC*YES|")
            stringBuilder.append("REF*AHC*NO|")
            stringBuilder.append("REF*2I*" + setStringMaximum((BOLAWBTrackingNo), 30) + "|")
            stringBuilder.append("REF*ITN*" + setStringMaximum((ITN), 30) + "|")
            stringBuilder.append("DTM*" + DTMQualifier.trim() + "*" + `${year}${month}${date}` + "|")
            stringBuilder.append("DTM*011*" + `${year}${month}${date}` + "|")
            stringBuilder.append("DTM*011*" + `${year}${month}${date}` + "|")
            stringBuilder.append("DTM*" + DTMQualifier.trim() + "*" + dtCargoReadyDate + "|")
            stringBuilder.append("DTM*011*" + `${year}${month}${date}` + "**********" + dtCargoReadyDate + "|")
            stringBuilder.append("DTM*011*" + `${year}${month}${date}` + "**********" + dtCargoReadyDate + "|")
            stringBuilder.append("DTM*011*" + `${year}${month}${date}` + "|")
            stringBuilder.append("NTE*" + setStringMaximum(((SpecialInstructions)), 30) + "|")
            stringBuilder.append("FOB*" + PaymentCode + "|")
            stringBuilder.append("N1*CN*" + setStringMaximum((request.body.SHIPTO.COMPANY, 60)) + "|")
            stringBuilder.append("N2*" + setStringMaximum(((request.body.SHIPTO.CONTACT), 60)) + "*" + setStringMaximum(((request.body.SHIPTO.EMAIL), 45)) + "," + setStringMaximum(((request.body.SHIPTO.PHONE), 15)) + "|")
            stringBuilder.append("N3*" + setStringMaximum(((request.body.SHIPTO.ADDRESS_LINE1), 55)) + "*" + setStringMaximum(((request.body.SHIPTO.Address2), 55)) + "|")
            stringBuilder.append("N4*" + setStringMaximum(((request.body.SHIPTO.CITY), 30)) + "*" + request.body.SHIPTO.STATE.trim() + "*" + setStringMaximum(((request.body.SHIPTO.ZipCode), 15)) + "*" + setStringMaximum(((request.body.SHIPTO.COUNTRY), 3)) + "|")
            stringBuilder.append("N1*DA*" + setStringMaximum((request.body.SHIPTO.COMPANY, 60)) + "*6*" + setStringMaximum(((request.body.SHIPTO.STATE), 80)) + "|")
            stringBuilder.append("N2*" + setStringMaximum(((request.body.SHIPTO.CONTACT), 60)) + "*" + setStringMaximum(((request.body.SHIPTO.EMAIL), 45)) + "," + setStringMaximum(((request.body.SHIPTO.PHONE), 15)) + "|")
            stringBuilder.append("N3*" + setStringMaximum(((request.body.SHIPTO.ADDRESS_LINE1), 55)) + "*" + setStringMaximum(((request.body.SHIPTO.Address2), 55)) + "|")
            stringBuilder.append("N4*" + setStringMaximum(((request.body.SHIPTO.CITY), 30)) + "*" + request.body.SHIPTO.STATE.trim() + "*" + setStringMaximum(((request.body.SHIPTO.ZipCode), 15)) + "*" + setStringMaximum(((request.body.SHIPTO.COUNTRY), 3)) + "|")
            stringBuilder.append("N1*PU*" + setStringMaximum((request.body.SHIPPER.COMPANY, 60)) + "*6*" + setStringMaximum(((request.body.SHIPPER.STATE), 80)) + "|")
            stringBuilder.append("N2*" + setStringMaximum(((request.body.SHIPPER.CONTACT), 60)) + "*" + setStringMaximum(((request.body.SHIPPER.EMAIL), 45)) + ", " + setStringMaximum(((request.body.SHIPPER.PHONE), 15)) + "|")
            stringBuilder.append("N3*" + setStringMaximum(((request.body.SHIPPER.ADDRESS_LINE1), 55)) + "*" + setStringMaximum(((request.body.SHIPPER.Address2), 55)) + "|")
            stringBuilder.append("N4*" + setStringMaximum(((request.body.SHIPPER.CITY), 30)) + "*" + request.body.SHIPFROM.STATE.trim() + "*" + setStringMaximum(((request.body.SHIPPER.ZipCode), 15)) + "*" + setStringMaximum(((request.body.SHIPPER.COUNTRY), 3)) + "|")
            stringBuilder.append("N1*NP*" + setStringMaximum((request.body.SOLDTO.COMPANY, 60)) + "*6*" + setStringMaximum(((request.body.SOLDTO.STATE), 80)) + "|")
            stringBuilder.append("N2*" + setStringMaximum(((request.body.SOLDTO.CONTACT), 60)) + "*" + setStringMaximum(((request.body.SOLDTO.EMAIL), 45)) + ", " + setStringMaximum(((request.body.SOLDTO.PHONE), 15)) + "|")
            stringBuilder.append("N3*" + setStringMaximum(((request.body.SOLDTO.ADDRESS_LINE1), 55)) + "*" + setStringMaximum(((request.body.SOLDTO.Address2), 55)) + "|")
            stringBuilder.append("N4*" + setStringMaximum(((request.body.SOLDTO.CITY), 30)) + "*" + request.body.SHIPFROM.STATE.trim() + "*" + setStringMaximum(((request.body.SOLDTO.ZipCode), 15)) + "*" + setStringMaximum(((request.body.SOLDTO.COUNTRY), 3)) + "|")
            stringBuilder.append("PER*CN*" + setStringMaximum(((request.body.SHIPTO.CONTACT), 60)) + "*TE*" + setStringMaximum(((request.body.SHIPTO.PHONE), 15)) + "***EM*" + setStringMaximum(((request.body.SHIPTO.EMAIL), 45)) + "|")
            stringBuilder.append("N1*SH*" + setStringMaximum(((request.body.SHIPFROM.COMPANY), 60)) + "*6*ZZ" + setStringMaximum(((request.body.SHIPFROM.COUNTRY), 3)) + "|")
            stringBuilder.append("N1*SH*" + setStringMaximum(((request.body.SHIPFROM.COMPANY), 60)) + "*6*" + setStringMaximum(((request.body.SHIPFROM.STATE), 80)) + "|")
            stringBuilder.append("N2*" + setStringMaximum(((request.body.SHIPFROM.CONTACT), 60)) + "*" + setStringMaximum(((request.body.SHIPFROM.EMAIL), 45)) + ", " + setStringMaximum(((request.body.SHIPFROM.PHONE), 15)) + "|")
            stringBuilder.append("N3*" + setStringMaximum(((request.body.SHIPFROM.ADDRESS_LINE1), 55)) + "*" + setStringMaximum(((request.body.SHIPFROM.Address2), 55)) + "|")
            stringBuilder.append("N4*" + setStringMaximum(((request.body.SHIPFROM.CITY), 30)) + "*" + request.body.SHIPFROM.STATE.trim() + "*" + setStringMaximum(((request.body.SHIPFROM.ZipCode), 15)) + "*" + setStringMaximum(((request.body.SHIPFROM.COUNTRY), 3)) + "|")
            stringBuilder.append("PER*SH*" + setStringMaximum(((request.body.SHIPFROM.CONTACT), 60)) + "*TE*" + setStringMaximum(((request.body.SHIPFROM.PHONE), 15)) + "***EM*" + setStringMaximum(((request.body.SHIPFROM.EMAIL), 45)) + "|")
            stringBuilder.append("N1*BT*" + setStringMaximum(((request.body.SHIPPER.COMPANY), 60)) + "*ZZ*" + setStringMaximum(((request.body.SHIPPER.AccountNo), 80)) + "|")
            stringBuilder.append("N2*" + setStringMaximum(((request.body.SHIPPER.CONTACT), 60)) + "*" + setStringMaximum(((request.body.SHIPPER.EMAIL), 45)) + ", " + setStringMaximum(((request.body.SHIPPER.PHONE), 15)) + "|")
            stringBuilder.append("N3*" + setStringMaximum(((request.body.SHIPPER.ADDRESS_LINE1), 55)) + "*" + setStringMaximum(((request.body.SHIPPER.Address2), 55)) + "|")
            stringBuilder.append("N4*" + setStringMaximum(((request.body.SHIPPER.CITY), 30)) + "*" + request.body.SHIPFROM.STATE.trim() + "*" + setStringMaximum(((request.body.SHIPPER.ZipCode), 15)) + "*" + setStringMaximum(((request.body.SHIPPER.COUNTRY), 3)) + "|")
            stringBuilder.append("HL*2*1*O" + "|")
            stringBuilder.append("TD1*PCS*" + (NoOfPieces) + "****G*" + iTotalWeight + "*" + (strEDIWeightUOM) + "*" + Math.round(iTotalPackageVolume) + "*" + (strEDIVolumeUOM) + "|")




      const resultString = stringBuilder.toString();
      
      console.log(resultString); 

//         const client = new ftp();

//         const config = {
//           host: '',
//           user: '',
//           password: '',
//         };
        
//         const ffolderPath = 'D:/SAP/XBackup';
//         const tfolderPath = '/V6/ECS_PWS_NEW';
//         const fileName = '1691564545.pdf';
        
//         const localFilePath =`${ffolderPath}/${fileName}`;
//         const remoteFilePath =`${tfolderPath}/${fileName}`;
//         console.log(localFilePath);
//         console.log(remoteFilePath);
    

       
// client.on('ready', () => {
//     client.put(localFilePath, remoteFilePath, (err) => {
//       if (err) {
//         console.error(err);
//       } else {
//         console.log('File transferred successfully');
//       }
//       client.end();
//     });
//   });
  
//   try 
//   {
//   client.connect(config);
// }
// catch(ex2){  console.log(ex2.message)}
       

        response.send(request.body).status(200);

    }
      catch(ex){
      console.log(ex.message)
          finalResponse = {};
          request.body['status'] = 'Error';
          request.body['Errors'] = [];
          request.body.Errors.push(ex.message)
          response.send(request.body).status(400);
          
    }
    //  response.send('working').status(ex.response.status);
});

function padRight(inputString, length, padChar = ' ') {
  const currentLength = inputString.length;
  
  if (currentLength >= length) {
      return inputString;
  }

  const paddingToAdd = length - currentLength;
  const padding = padChar.repeat(paddingToAdd);

  return inputString + padding;
}

function setStringMaximum(myString, desiredLength) {
  if (myString.length > desiredLength) {      myString = myString.slice(0, desiredLength);}
    return myString 
  }

module.exports = router;