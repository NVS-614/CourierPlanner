/**
 * SHIPCORE PRO - HIGH PERFORMANCE BULK INTEGRATION JOB (WITH METRICS)
 * -------------------------------------------------------------------
 * Strategy: "Chunking with Fuzzy Matching"
 * Updates:  Added full telemetry (Time, Round Trips, Latency breakdown).
 */

const axios = require('axios');
const https = require('https');

// --- 1. SYSTEM CONFIGURATION ---
const CONFIG = {
    baseURL: 'https://pcs4h2022.plutocloud.com:8443',
    auth: {
        username: 'raju',
        password: 'Pluto12345'
    },
    api: {
        ewm: '/sap/opu/odata4/sap/api_warehouse_odo_2/srvd_a2x/sap/warehouseoutbdeliveryorder/0001/WhseOutboundDeliveryOrderHead',
        s4Delivery: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader',
        salesOrder: '/sap/opu/odata4/sap/api_salesorder/srvd_a2x/sap/salesorder/0001/SalesOrder',
        handlingUnit: '/sap/opu/odata4/sap/api_handlingunit/srvd_a2x/sap/handlingunit/0001/HandlingUnit'
    },
    batchSize: 20
};

// --- GLOBAL METRICS STORE ---
const PERFORMANCE = {
    startTime: 0,
    endTime: 0,
    roundTrips: 0,
    apiStats: {
        'EWM': { count: 0, totalMs: 0 },
        'S4': { count: 0, totalMs: 0 },
        'HU': { count: 0, totalMs: 0 },
        'SO': { count: 0, totalMs: 0 }
    }
};

const client = axios.create({
    baseURL: CONFIG.baseURL,
    auth: CONFIG.auth,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { 'Accept': 'application/json' }
});

// --- 2. UTILITY FUNCTIONS ---

/** Wrapper to measure individual API calls */
async function measureCall(label, url) {
    const start = Date.now();
    PERFORMANCE.roundTrips++;
    try {
        const res = await client.get(url);
        const duration = Date.now() - start;

        // Log stats
        PERFORMANCE.apiStats[label].count++;
        PERFORMANCE.apiStats[label].totalMs += duration;

        return res;
    } catch (e) {
        // Still count failed calls towards network traffic
        const duration = Date.now() - start;
        PERFORMANCE.apiStats[label].count++;
        PERFORMANCE.apiStats[label].totalMs += duration;
        throw e;
    }
}

function chunkArray(myArray, chunk_size) {
    const results = [];
    const arrCopy = [...myArray];
    while (arrCopy.length) {
        results.push(arrCopy.splice(0, chunk_size));
    }
    return results;
}

function buildOrFilter(fieldName, values) {
    if (!values || values.length === 0) return '';
    return values.map(val => `${fieldName} eq '${val}'`).join(' or ');
}

// --- 3. MAIN WORKFLOW ---

async function runbulkewmShipCoreJob(inputIds) {
    PERFORMANCE.startTime = Date.now(); // <--- START TIMER

    if (inputIds.length === 0) {
        console.error("❌ Usage: node shipcore-complete.js <DELIVERY_ID_1> [DELIVERY_ID_2] ...");
        return;
    }

    // Deduplicate inputs
    inputIds = [...new Set(inputIds)];
    console.log(`\n📦 QUEUED JOBS: ${inputIds.length} Deliveries to Process.`);

    // STORAGE FOR ALL RESULTS
    let allEwm = [];
    let allS4 = [];
    let allHu = [];
    let allSo = [];

    // --- PHASE 1: FETCH DELIVERIES (EWM, S4, HU) ---
    const chunks = chunkArray(inputIds, CONFIG.batchSize);
    console.log(`🚀 [1/3] Fetching Delivery Data in ${chunks.length} batch(es)...`);

    // Process chunks in parallel
    const chunkPromises = chunks.map(async (chunkIds, idx) => {
        const paddedIds = chunkIds.map(id => id.padStart(10, '0'));
        const batchStart = Date.now();

        // Fire 3 requests in parallel
        const [ewmRes, s4Res, huRes] = await Promise.all([
            fetchEwmList(paddedIds),
            fetchS4List(paddedIds),
            fetchHuList(chunkIds)
        ]);

        const batchDuration = Date.now() - batchStart;

        // DEBUG LOGGING
        if (ewmRes.length > 0) {
            console.log(`    ✅ Batch ${idx + 1} received in ${batchDuration}ms. Sample ID: "${ewmRes[0].EWMOutboundDeliveryOrder}"`);
        } else {
            console.log(`    ⚠️ Batch ${idx + 1} returned 0 results in ${batchDuration}ms.`);
        }

        return { ewmRes, s4Res, huRes };
    });

    // Wait for all chunks
    const chunkResults = await Promise.all(chunkPromises);

    // Merge results
    chunkResults.forEach(res => {
        allEwm.push(...res.ewmRes);
        allS4.push(...res.s4Res);
        allHu.push(...res.huRes);
    });

    console.log(`    📊 Total Fetched: ${allEwm.length} EWM, ${allS4.length} S/4, ${allHu.length} HUs`);

    // --- PHASE 2: DISCOVER & FETCH SALES ORDERS ---
    const soIds = new Set();
    allEwm.forEach(d => {
        if (d._WhseOutbDeliveryOrderItem) {
            d._WhseOutbDeliveryOrderItem.forEach(i => {
                if (i.SalesOrder) soIds.add(i.SalesOrder);
            });
        }
    });

    if (soIds.size > 0) {
        console.log(`🚀 [2/3] Fetching ${soIds.size} unique Sales Orders...`);
        const soChunks = chunkArray([...soIds], CONFIG.batchSize);
        const soPromises = soChunks.map(chunk => fetchSoList(chunk));
        const soResults = await Promise.all(soPromises);
        soResults.forEach(r => allSo.push(...r));
    }

    // --- PHASE 3: MERGE & MAP (FIXED FUZZY MATCHING) ---
    console.log(`🚀 [3/3] Generating final payload...`);

    const finalOutput = [];

    for (const rawId of inputIds) {
        const paddedId = rawId.padStart(10, '0');
        const unpaddedId = rawId.replace(/^0+/, '');

        // 1. Find EWM Header (Fuzzy Match: Check BOTH padded and unpadded)
        const ewm = allEwm.find(x =>
            x.EWMOutboundDeliveryOrder === paddedId ||
            x.EWMOutboundDeliveryOrder === unpaddedId ||
            x.EWMOutboundDeliveryOrder == rawId
        );

        if (!ewm) {
            console.error(`❌ Delivery ${rawId} (Padded: ${paddedId}) not found in results.`);
            continue;
        }

        // 2. Find S/4 Header (Fuzzy Match)
        const s4 = allS4.find(x =>
            x.DeliveryDocument === paddedId ||
            x.DeliveryDocument === unpaddedId
        );

        // 3. Find HUs (Fuzzy Match)
        const hu = allHu.filter(x =>
            x.HandlingUnitReferenceDocument === rawId ||
            x.HandlingUnitReferenceDocument === paddedId ||
            x.HandlingUnitReferenceDocument === unpaddedId
        );

        // 4. Find Sales Order
        let so = null;
        const firstItem = ewm._WhseOutbDeliveryOrderItem?.[0];
        if (firstItem && firstItem.SalesOrder) {
            so = allSo.find(s => s.SalesOrder === firstItem.SalesOrder);
        }

        // 5. Run Mapping Logic
        try {
            const mappedData = mapToShipCoreSchema(ewm, s4, hu, so);
            finalOutput.push(mappedData);
        } catch (e) {
            console.error(`❌ Error mapping ${rawId}: ${e.message}`);
        }
    }

    // --- OUTPUT RESULT ---
    console.log(JSON.stringify(finalOutput, null, 2));
    return finalOutput;
    // --- PERFORMANCE SUMMARY ---
    // PERFORMANCE.endTime = Date.now();
    // printPerformanceReport(finalOutput.length);
}

// --- 4. OPTIMIZED DATA FETCHERS (WITH METRICS) ---

async function fetchEwmList(ids) {
    if (!ids.length) return [];
    const filter = buildOrFilter('EWMOutboundDeliveryOrder', ids);
    const query = `?$filter=(${filter})&$expand=_WhseOutbDeliveryOrderItem`;
    try {
        // Wrapped with measureCall
        const res = await measureCall('EWM', CONFIG.api.ewm + query);
        return res.data.value || [];
    } catch (e) {
        console.error("   ⚠️ EWM Fetch Error");
        return [];
    }
}

async function fetchS4List(ids) {
    if (!ids.length) return [];
    const filter = buildOrFilter('DeliveryDocument', ids);
    const query = `?$filter=${filter}&$expand=to_DeliveryDocumentPartner/to_Address,to_DeliveryDocumentText,to_DeliveryDocumentItem&$format=json`;
    try {
        const res = await measureCall('S4', CONFIG.api.s4Delivery + query);
        return res.data.d.results || [];
    } catch (e) {
        console.error("   ⚠️ S/4 Fetch Error");
        return [];
    }
}

async function fetchHuList(ids) {
    if (!ids.length) return [];
    const filter = buildOrFilter('HandlingUnitReferenceDocument', ids);
    const query = `?$filter=(${filter})&$expand=_HandlingUnitItem($expand=_HandlingUnitItemSerialNumber)`;
    try {
        const res = await measureCall('HU', CONFIG.api.handlingUnit + query);
        return res.data.value || [];
    } catch (e) {
        console.error("   ⚠️ HU Fetch Error");
        return [];
    }
}

async function fetchSoList(ids) {
    if (!ids.length) return [];
    const filter = buildOrFilter('SalesOrder', ids);
    const query = `?$filter=(${filter})&$expand=_Item($expand=_ItemPricingElement($filter=ConditionType eq 'PR00')),_Partner`;
    try {
        const res = await measureCall('SO', CONFIG.api.salesOrder + query);
        return res.data.value || [];
    } catch (e) {
        console.error("   ⚠️ SO Fetch Error");
        return [];
    }
}

// --- 5. REPORTING FUNCTION ---

function printPerformanceReport(processedCount) {
    const totalDuration = (PERFORMANCE.endTime - PERFORMANCE.startTime) / 1000;

    console.log(`\n===============================================================`);
    console.log(`🏁 SHIPCORE PRO PERFORMANCE DIAGNOSTICS`);
    console.log(`===============================================================`);
    console.log(`⏱️  Total Job Duration:   ${totalDuration.toFixed(3)} seconds`);
    console.log(`📦 Deliveries Processed: ${processedCount}`);
    console.log(`🔄 Network Round Trips:  ${PERFORMANCE.roundTrips}`);

    if (processedCount > 0) {
        console.log(`🚀 Avg Time per Delivery: ${(totalDuration / processedCount).toFixed(3)} seconds`);
    }

    console.log(`\n--- Service Breakdown (Latency) ---`);
    console.table(Object.entries(PERFORMANCE.apiStats).map(([service, stats]) => ({
        Service: service,
        'Calls': stats.count,
        'Avg Latency (ms)': stats.count > 0 ? (stats.totalMs / stats.count).toFixed(0) : 0,
        'Total Wait (ms)': stats.totalMs
    })));
    console.log(`===============================================================`);
}

// --- 6. MAPPING ENGINE (Exactly as provided) ---

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

    // --- PARTNER MERGE ---
    const s4Partners = (s4?.to_DeliveryDocumentPartner?.results || []).map(p => ({
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
            transactionId: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            deliveryId: ewm.EWMOutboundDeliveryOrder,
            warehouseId: ewm.EWMWarehouse,

            // S/4 Delivery Header Fields
            deliveryType: s4?.DeliveryDocumentType || "",
            shippingPoint: s4?.ShippingPoint || "",
            SoldToParty: s4?.SoldToParty || "",
            ShipToParty: s4?.ShipToParty || "",

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
            customerGroup: s4?.CustomerGroup || "",
            priority: s4?.DeliveryPriority || "",
            sdCategory: s4?.SDDocumentCategory || "",
            shippingCondition: s4?.ShippingCondition || "",
            shippingType: s4?.ShippingType || "",

            // Statuses
            overallPickingStatus: overallPicking,
            overallPackingStatus: overallPacking,
            overallGoodsIssueStatus: overallGI,

            // Weights/Volumes
            grossWeight: s4?.HeaderGrossWeight || "0",
            netWeight: s4?.HeaderNetWeight || "0",
            weightUnit: s4?.HeaderWeightUnit || "",
            volume: s4?.HeaderVolume || "0",
            volumeUnit: s4?.HeaderVolumeUnit || "",

            // EWM Specifics
            shipDate: ewm.PlannedDeliveryUTCDateTime,
            incoterms: ewm.IncotermsPart1,
            incotermsLocation: ewm.IncotermsPart2,
            instructions: s4?.instructions || ""
        },

        // --- PARTNERS ---
        partners: s4Partners,

        // --- MATERIALS (EWM + S/4 + SO Merge) ---
        materials: ewm._WhseOutbDeliveryOrderItem.map(ewmItem => {
            const s4Items = s4?.to_DeliveryDocumentItem?.results || [];
            const s4Item = s4Items.find(si => parseInt(si.DeliveryDocumentItem) === parseInt(ewmItem.EWMOutboundDeliveryOrderItem));

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
                    unitPrice: (soItem && soItem._ItemPricingElement && soItem._ItemPricingElement[0]) ? soItem._ItemPricingElement[0].ConditionRateAmount : 0
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

module.exports = { runbulkewmShipCoreJob }