/**
 * SHIPCORE PRO - FULL INTEGRATION JOB (MULTI-DELIVERY SUPPORT)
 * ------------------------------------------------------------
 * Features:
 * - Supports processing multiple Delivery IDs in one run.
 * - Full EWM & S/4 Delivery Merge.
 * - Comprehensive Handling Unit Fields.
 * - Complete Partner Address Logic.
 * * Usage: node shipcore-complete.js <DELIVERY_ID_1> <DELIVERY_ID_2> ...
 */

const axios = require('axios');
const https = require('https');

// --- 1. SYSTEM CONFIGURATION ---
const CONFIG = {
    baseURL: 'https://pcs4h2022.plutocloud.com:8443',
    auth: {
        username: 'raju',      // <--- Replaced for security
        password: 'Pluto12345'   // <--- Replaced for security
    },
    api: {
        ewm: '/sap/opu/odata4/sap/api_warehouse_odo_2/srvd_a2x/sap/warehouseoutbdeliveryorder/0001/WhseOutboundDeliveryOrderHead',
        s4Delivery: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader',
        salesOrder: '/sap/opu/odata4/sap/api_salesorder/srvd_a2x/sap/salesorder/0001/SalesOrder',
        handlingUnit: '/sap/opu/odata4/sap/api_handlingunit/srvd_a2x/sap/handlingunit/0001/HandlingUnit'
    }
};

const client = axios.create({
    baseURL: CONFIG.baseURL,
    auth: CONFIG.auth,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }), 
    headers: { 'Accept': 'application/json' }
});

// --- 2. MAIN WORKFLOW ---
async function runShipCoreJob() {
    // CAPTURE ALL ARGUMENTS AFTER THE SCRIPT NAME
    const inputIds = process.argv.slice(2);
    
    if (inputIds.length === 0) {
        console.error("❌ Usage: node shipcore-complete.js <DELIVERY_ID_1> [DELIVERY_ID_2] ...");
        return;
    }

    console.log(`\n📦 QUEUED JOBS: ${inputIds.length} Deliveries to Process: [ ${inputIds.join(', ')} ]`);

    // LOOP THROUGH EACH ID SEQUENTIALLY
    for (const deliveryIdRaw of inputIds) {
        await processSingleDelivery(deliveryIdRaw);
    }
    
    console.log(`\n✅ ALL JOBS COMPLETE.`);
}

async function processSingleDelivery(deliveryIdRaw) {
    const deliveryIdPadded = deliveryIdRaw.padStart(10, '0');

    console.log(`\n--------------------------------------------------------`);
    console.log(`🚀 PROCESSING DELIVERY: ${deliveryIdRaw}`);
    console.log(`--------------------------------------------------------`);

    try {
        // STEP 1: FETCH EWM (Master Data)
        console.log(`[1/4] Fetching EWM Data...`);
        const ewmData = await fetchEwmData(deliveryIdPadded);
        
        if (!ewmData) { 
            console.error(`❌ EWM Delivery ${deliveryIdRaw} not found. Skipping...`); 
            return; 
        }
        
        // STEP 2: FETCH S/4 LE DELIVERY
        console.log(`[2/4] Fetching S/4 Delivery...`);
        const s4Data = await fetchS4Delivery(deliveryIdPadded);
        if (s4Data) console.log(`   ✅ S/4 Data retrieved.`);

        // STEP 3: FETCH HANDLING UNITS (Raw ID)
        console.log(`[3/4] Fetching Handling Units...`);
        const huData = await fetchHandlingUnits(deliveryIdRaw);
        console.log(`   ✅ Found ${huData.length} Handling Unit(s).`);

        // STEP 4: FETCH SALES ORDER
        let soData = null;
        const firstItem = ewmData._WhseOutbDeliveryOrderItem[0];
        if (firstItem && firstItem.SalesOrder) {
            console.log(`[4/4] Fetching Sales Order ${firstItem.SalesOrder}...`);
            soData = await fetchSalesOrder(firstItem.SalesOrder);
        }

        // STEP 5: MERGE & MAP
        console.log(`🔄 Merging Data...`);
        const finalPayload = mapToShipCoreSchema(ewmData, s4Data, huData, soData);

        // STEP 6: OUTPUT
        console.log(`\n>> JSON OUTPUT FOR ${deliveryIdRaw}:`);
        console.log(JSON.stringify(finalPayload, null, 2));

    } catch (err) {
        console.error(`❌ ERROR processing ${deliveryIdRaw}:`, err.message);
    }
}

// --- 3. MAPPING ENGINE (FULL FIELDS) ---

function mapToShipCoreSchema(ewm, s4, hus, so) {
    
    // --- STATUS LOGIC ---
    const calculateOverall = (items, fieldName) => {
        if (!items || items.length === 0) return "";
        const allNine = items.every(i => i[fieldName] === '9');
        const allOne = items.every(i => i[fieldName] === '1');
        return allNine ? '9' : (allOne ? '1' : '4');
    };

    const overallPicking = calculateOverall(ewm._WhseOutbDeliveryOrderItem, 'PickingStatus');
    const overallGI = calculateOverall(ewm._WhseOutbDeliveryOrderItem, 'GoodsIssueStatus');
    const overallPacking = calculateOverall(ewm._WhseOutbDeliveryOrderItem, 'CompletionStatus');

    // --- PARTNER MERGE (With Complete Address Fields) ---
    const s4Partners = (s4?.partners || []).map(p => ({
        role: p.PartnerFunction,
        id: p.Customer || p.Supplier || p.Personnel,
        name: p.to_Address?.FullName || p.to_Address?.BusinessPartnerName1 || "",
        address: {
            street: p.to_Address?.StreetName || "",
            houseNumber: p.to_Address?.HouseNumber || "",
            city: p.to_Address?.CityName || "",
            district: p.to_Address?.District || "",
            region: p.to_Address?.Region || "",
            postalCode: p.to_Address?.PostalCode || "",
            country: p.to_Address?.Country || "",
            phone: p.to_Address?.PhoneNumber || "", 
            email: p.to_Address?.EmailAddress || "" 
        }
    }));

    // Backfill from SO
    const soPartners = (so?._Partner || []).map(p => ({
        role: p.PartnerFunction,
        id: p.Customer || p.Supplier,
        name: p.BusinessPartnerName1 || "",
        address: {
            street: p.StreetName || "",
            houseNumber: p.HouseNumber || "",
            city: p.CityName || "",
            district: p.District || "",
            region: p.Region || "",
            postalCode: p.PostalCode || "",
            country: p.Country || "",
            email: p.EmailAddress || ""
        }
    }));

    soPartners.forEach(soP => {
        if (!s4Partners.some(s4P => s4P.role === soP.role)) s4Partners.push(soP);
    });

    return {
        // --- HEADER ---
        header: {
            transactionId: `TXN-${Date.now()}`,
            deliveryId: ewm.EWMOutboundDeliveryOrder,
            warehouseId: ewm.EWMWarehouse,
            
            // S/4 Delivery Header Fields
            deliveryType: s4?.header?.DeliveryDocumentType || "",
            shippingPoint: s4?.header?.ShippingPoint || "",
            SoldToParty: s4?.header?.SoldToParty || "", 
            ShipToParty: s4?.header?.ShipToParty || "", 
            
            // Sales Order Header Fields
            SalesOrganization: so ? so.SalesOrganization : "",
            DistributionChannel: so ? so.DistributionChannel : "",
            SalesOrderType: so ? so.SalesOrderType : "",
            OrganizationDivision: so ? so.OrganizationDivision : "",
            TotalNetAmount: so ? so.TotalNetAmount : 0.00,
            TransactionCurrency: so ? so.TransactionCurrency : "",
            
            // Sales Order Statuses
            OverallDeliveryBlockStatus: so ? so.OverallDeliveryBlockStatus : "",
            OverallBillingBlockStatus: so ? so.OverallBillingBlockStatus : "",
            TotalCreditCheckStatus: so ? so.TotalCreditCheckStatus : "",
            OverallDangerousGoodsStatus: so ? so.OverallDangerousGoodsStatus : "",
            OverallSafetyDataSheetStatus: so ? so.OverallSafetyDataSheetStatus : "",
            OverallTrdCmplncEmbargoSts: so ? so.OverallTrdCmplncEmbargoSts : "",
            OvrlTrdCmplncSnctndListChkSts: so ? so.OvrlTrdCmplncSnctndListChkSts : "",
            OvrlTrdCmplncLegalCtrlChkSts: so ? so.OvrlTrdCmplncLegalCtrlChkSts : "",

            // Other Existing Fields
            customerGroup: s4?.header?.CustomerGroup || "",
            priority: s4?.header?.DeliveryPriority || "",
            sdCategory: s4?.header?.SDDocumentCategory || "",
            shippingCondition: s4?.header?.ShippingCondition || "",
            shippingType: s4?.header?.ShippingType || "",
            
            // Statuses
            overallPickingStatus: overallPicking,
            overallPackingStatus: overallPacking,
            overallGoodsIssueStatus: overallGI,
            
            // Weights/Volumes
            grossWeight: s4?.header?.HeaderGrossWeight || "0",
            netWeight: s4?.header?.HeaderNetWeight || "0",
            weightUnit: s4?.header?.HeaderWeightUnit || "",
            volume: s4?.header?.HeaderVolume || "0",
            volumeUnit: s4?.header?.HeaderVolumeUnit || "",

            // EWM Specifics
            shipDate: ewm.PlannedDeliveryUTCDateTime,
            incoterms: ewm.IncotermsPart1,
            incotermsLocation: ewm.IncotermsPart2,
            instructions: s4 ? s4.instructions : ""
        },

        // --- PARTNERS ---
        partners: s4Partners,

        // --- MATERIALS (EWM + S/4 + SO Merge) ---
        materials: ewm._WhseOutbDeliveryOrderItem.map(ewmItem => {
            const s4Item = s4?.items.find(si => parseInt(si.DeliveryDocumentItem) === parseInt(ewmItem.EWMOutboundDeliveryOrderItem));
            let soItem = null;
            if (so && ewmItem.SalesOrder) {
                soItem = so._Item.find(si => si.SalesOrderItem === ewmItem.SalesOrderItem);
            }

            return {
                // Identity
                EWMOutboundDeliveryOrder: ewmItem.EWMOutboundDeliveryOrder,
                itemId: ewmItem.EWMOutboundDeliveryOrderItem,
                material: ewmItem.Product,
                description: s4Item ? s4Item.DeliveryDocumentItemText : (ewmItem.ProductDescription || ""),
                batch: ewmItem.Batch,
                plant: s4Item ? s4Item.Plant : "",
                CountryOfOrigin: ewmItem.CountryOfOrigin,
                
                // Status
                status: {
                    picking: ewmItem.PickingStatus,
                    packing: ewmItem.CompletionStatus,
                    goodsIssue: ewmItem.GoodsIssueStatus
                },

                // S/4 Details
                s4Details: {
                    documentNumber: s4Item ? s4Item.DeliveryDocument : "",
                    itemNumber: s4Item ? s4Item.DeliveryDocumentItem : "",
                    itemCategory: s4Item ? s4Item.DeliveryDocumentItemCategory : "",
                    higherLevelItem: s4Item ? s4Item.HigherLevelItem : "000000",
                    deliveryGroup: s4Item ? s4Item.DeliveryGroup : "000",
                    refSdDoc: s4Item ? s4Item.ReferenceSDDocument : ""
                },

                // Weights & Quantities
                quantity: {
                    ewmQty: ewmItem.ProductQuantity,
                    ewmUom: ewmItem.QuantityUnit,
                    s4ActualQty: s4Item ? s4Item.ActualDeliveryQuantity : "0",
                    s4BaseQty: s4Item ? s4Item.ActualDeliveredQtyInBaseUnit : "0",
                    baseUnit: s4Item ? s4Item.BaseUnit : "",
                    deliveryUnit: s4Item ? s4Item.DeliveryQuantityUnit : ""
                },
                measures: {
                    grossWeight: s4Item ? s4Item.ItemGrossWeight : "0",
                    netWeight: s4Item ? s4Item.ItemNetWeight : "0",
                    weightUnit: s4Item ? s4Item.ItemWeightUnit : "",
                    volume: s4Item ? s4Item.ItemVolume : "0",
                    volumeUnit: s4Item ? s4Item.ItemVolumeUnit : ""
                },

                // Financials
                financials: {
                    customerPO: soItem ? soItem.PurchaseOrderByCustomer : "",
                    netAmount: soItem ? soItem.NetAmount : 0,
                    currency: soItem ? soItem.TransactionCurrency : "USD",
                    unitPrice: (soItem && soItem._ItemPricingElement[0]) ? soItem._ItemPricingElement[0].ConditionRateAmount : 0
                }
            };
        }),

        // --- PACKAGES (FULL HANDLING UNIT DETAILS) ---
        packages: hus.map(hu => ({
            // 1. Header Fields
            HandlingUnitExternalID: hu.HandlingUnitExternalID,
            Warehouse: hu.Warehouse,
            Plant: hu.Plant,
            PackagingMaterial: hu.PackagingMaterial,
            PackagingMaterialType: hu.PackagingMaterialType,
            
            // 2. Hierarchy
            ParentHandlingUnitNumber: hu.ParentHandlingUnitNumber,
            HighestLevelHandlingUnitNumber: hu.HighestLevelHandlingUnitNumber,
            EWMConsolidationGroup: hu.EWMConsolidationGroup,
            
            // 3. Weights
            GrossWeight: hu.GrossWeight,
            NetWeight: hu.NetWeight,
            WeightUnit: hu.WeightUnit,
            
            // 4. Volumetrics
            GrossVolume: hu.GrossVolume,
            VolumeUnit: hu.VolumeUnit,
            
            // 5. Dimensions
            HandlingUnitLength: hu.HandlingUnitLength,
            HandlingUnitWidth: hu.HandlingUnitWidth,
            HandlingUnitHeight: hu.HandlingUnitHeight,
            UnitOfMeasureDimension: hu.UnitOfMeasureDimension,
            
            // 6. References
            HandlingUnitReferenceDocument: hu.HandlingUnitReferenceDocument,
            HandlingUnitRefDocType: hu.HandlingUnitRefDocType,
            HandlingUnitHasCrossRefDoc: hu.HandlingUnitHasCrossRefDoc,
            HandlingUnitIsClosed: hu.HandlingUnitIsClosed,
            
            // 7. Packed Items
            packedItems: (hu._HandlingUnitItem || []).map(hi => ({
                huItemId: hi.HandlingUnitItem,
                material: hi.Material,
                quantity: hi.HandlingUnitQuantity,
                uom: hi.HndlgUnitQuantityUnitISOCode,
                batch: hi.Batch,
                plant: hi.Plant,
                storageLocation: hi.StorageLocation,
                
                // Specific Item Fields
                HandlingUnitReferenceDocument: hi.HandlingUnitReferenceDocument,
                HandlingUnitRefDocumentItem: hi.HandlingUnitRefDocumentItem,
                HandlingUnitQuantityUnit: hi.HandlingUnitQuantityUnit,
                HandlingUnitAltUnitOfMeasure: hi.HandlingUnitAltUnitOfMeasure,
                SerialNumberProfile: hi.SerialNumberProfile,
                HandlingUnitNumberOfSerialNumb: hi.HandlingUnitNumberOfSerialNumb,
                HandlingUnitExternalID: hi.HandlingUnitExternalID,
                HandlingUnitTypeOfContent: hi.HandlingUnitTypeOfContent,
                HandlingUnitNestedExternalID: hi.HandlingUnitNestedExternalID,
                
                // Serials
                serials: (hi._HandlingUnitItemSerialNumber || []).map(s => s.SerialNumber || s.EWMSerialNumber)
            }))
        }))
    };
}

// --- 4. DATA FETCHERS ---

async function fetchEwmData(id) {
    const query = `?$filter=EWMOutboundDeliveryOrder eq '${id}'&$expand=_WhseOutbDeliveryOrderItem`;
    try {
        const res = await client.get(CONFIG.api.ewm + query);
        return res.data.value[0]; 
    } catch (e) { return null; }
}

async function fetchS4Delivery(id) {
    const query = `?$filter=DeliveryDocument eq '${id}'&$expand=to_DeliveryDocumentPartner/to_Address,to_DeliveryDocumentText,to_DeliveryDocumentItem&$format=json`;
    try {
        const res = await client.get(CONFIG.api.s4Delivery + query);
        const results = res.data.d.results;
        if (results.length > 0) {
            const d = results[0];
            const instr = (d.to_DeliveryDocumentText.results || []).find(t => t.TextElement === 'TX03');
            return {
                header: d,
                partners: d.to_DeliveryDocumentPartner.results,
                items: d.to_DeliveryDocumentItem.results,
                instructions: instr ? instr.TextElementText : ""
            };
        }
        return null;
    } catch (e) { return null; }
}

async function fetchHandlingUnits(rawId) {
    const query = `?$filter=HandlingUnitReferenceDocument eq '${rawId}'&$expand=_HandlingUnitItem($expand=_HandlingUnitItemSerialNumber)`;
    try {
        const res = await client.get(CONFIG.api.handlingUnit + query);
        return res.data.value; 
    } catch (e) { return []; }
}

async function fetchSalesOrder(soId) {
    const lookupId = /^\d+$/.test(soId) ? soId.padStart(10, '0') : soId;
    const query = `?$filter=SalesOrder eq '${lookupId}'&$expand=_Item($expand=_ItemPricingElement($filter=ConditionType eq 'PR00')),_Partner`;
    try {
        const res = await client.get(CONFIG.api.salesOrder + query);
        return res.data.value[0];
    } catch (e) { return null; }
}

// Execute
runShipCoreJob();