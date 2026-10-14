/**
 * SHIPCORE PRO - S/4HANA ONLY INTEGRATION JOB
 * -------------------------------------------
 * - Full Field Mapping for Materials, PACKAGES, and Packed Items.
 * - S/4 Centric (No EWM).
 * - Includes Performance Metrics.
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
        s4Delivery: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader',
        salesOrder: '/sap/opu/odata4/sap/api_salesorder/srvd_a2x/sap/salesorder/0001/SalesOrder'
    },
    batchSize: 20
};

// --- GLOBAL METRICS STORE ---
const PERFORMANCE = {
    startTime: 0,
    endTime: 0,
    roundTrips: 0,
    apiStats: {
        'S4': { count: 0, totalMs: 0 },
        'SO': { count: 0, totalMs: 0 }
    }
};

const client = axios.create({
    baseURL: CONFIG.baseURL,
    auth: CONFIG.auth,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: { 'Accept': 'application/json' },
    timeout: 10000
});

// --- 2. UTILITY FUNCTIONS ---

async function measureCall(label, url) {
    const start = Date.now();
    PERFORMANCE.roundTrips++;
    try {
        const res = await client.get(url);
        const duration = Date.now() - start;
        PERFORMANCE.apiStats[label].count++;
        PERFORMANCE.apiStats[label].totalMs += duration;
        return res;
    } catch (e) {
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

async function runbulks4ShipCoreJob(inputIds) {
    PERFORMANCE.startTime = Date.now();

    if (inputIds.length === 0) {
        console.error("❌ Usage: node shipcore-s4-only.js <DELIVERY_ID_1> ...");
        return;
    }

    inputIds = [...new Set(inputIds)];
    console.log(`\n📦 QUEUED JOBS: ${inputIds.length} S/4 Deliveries to Process.`);

    let allS4 = [];
    let allSo = [];

    // --- PHASE 1: FETCH S/4 DELIVERIES ---
    const chunks = chunkArray(inputIds, CONFIG.batchSize);
    console.log(`🚀 [1/3] Fetching S/4 Data (Header, Items, HUs) in ${chunks.length} batch(es)...`);

    for (let i = 0; i < chunks.length; i++) {
        const chunkIds = chunks[i];
        const paddedIds = chunkIds.map(id => id.padStart(10, '0'));
        const batchStart = Date.now();

        try {
            const s4Res = await fetchS4List(paddedIds);
            const batchDuration = Date.now() - batchStart;

            if (s4Res.length > 0) {
                console.log(`    ✅ Batch ${i + 1} received in ${batchDuration}ms. Sample: "${s4Res[0].DeliveryDocument}"`);
            } else {
                console.log(`    ⚠️ Batch ${i + 1} returned 0 results.`);
            }
            allS4.push(...s4Res);
        } catch (err) {
            console.error(`    ❌ Batch ${i + 1} FAILED: ${err.message}`);
        }
    }

    // --- PHASE 2: DISCOVER & FETCH SALES ORDERS ---
    const soIds = new Set();
    allS4.forEach(d => {
        if (d.to_DeliveryDocumentItem && d.to_DeliveryDocumentItem.results) {
            d.to_DeliveryDocumentItem.results.forEach(item => {
                if (item.ReferenceSDDocument) soIds.add(item.ReferenceSDDocument);
            });
        }
    });

    if (soIds.size > 0) {
        console.log(`🚀 [2/3] Fetching ${soIds.size} unique Sales Orders...`);
        const soChunks = chunkArray([...soIds], CONFIG.batchSize);
        const soPromises = soChunks.map(chunk => fetchSoList(chunk));

        try {
            const soResults = await Promise.all(soPromises);
            soResults.forEach(r => allSo.push(...r));
        } catch (err) {
            console.error(`    ❌ Sales Order Fetch Failed: ${err.message}`);
        }
    } else {
        console.log(`ℹ️  [2/3] No Sales Order references found.`);
    }

    // --- PHASE 3: MERGE & MAP ---
    console.log(`🚀 [3/3] Generating final payload...`);
    const finalOutput = [];

    for (const rawId of inputIds) {
        const paddedId = rawId.padStart(10, '0');
        const unpaddedId = rawId.replace(/^0+/, '');

        // 1. Find S/4 Header
        const s4 = allS4.find(x =>
            x.DeliveryDocument === paddedId ||
            x.DeliveryDocument === unpaddedId ||
            x.DeliveryDocument === rawId
        );

        if (!s4) {
            console.error(`❌ Delivery ${rawId} not found in S/4.`);
            continue;
        }

        // 2. Find Sales Order
        let so = null;
        const firstItem = s4.to_DeliveryDocumentItem?.results?.[0];
        if (firstItem && firstItem.ReferenceSDDocument) {
            so = allSo.find(s => s.SalesOrder === firstItem.ReferenceSDDocument);
        }

        // 3. Map
        try {
            const mappedData = mapS4ToShipCore(s4, so);
            finalOutput.push(mappedData);
        } catch (e) {
            console.error(`❌ Error mapping ${rawId}: ${e.message}`);
        }
    }

    // --- OUTPUT ---
    console.log(JSON.stringify(finalOutput, null, 2));

    return finalOutput;
    // --- PERFORMANCE SUMMARY ---
    // PERFORMANCE.endTime = Date.now();
    // printPerformanceReport(finalOutput.length);
}

// --- 4. DATA FETCHERS ---

async function fetchS4List(ids) {
    if (!ids.length) return [];
    const filter = buildOrFilter('DeliveryDocument', ids);

    // Exact Working Expansions
    const expansions = [
        'to_DeliveryDocumentPartner/to_Address',
        'to_DeliveryDocumentItem',
        'to_HandlingUnitHeaderDelivery',
        'to_HandlingUnitHeaderDelivery/to_HandlingUnitItemDelivery'
    ].join(',');

    const query = `?$filter=${filter}&$expand=${expansions}&$format=json`;

    try {
        const res = await measureCall('S4', CONFIG.api.s4Delivery + query);
        return res.data.d.results || [];
    } catch (e) {
        console.error(`   ⚠️ S/4 Request Error: ${e.message}`);
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
    } catch (e) { return []; }
}

// --- 5. REPORTING ---

function printPerformanceReport(processedCount) {
    const totalDuration = (PERFORMANCE.endTime - PERFORMANCE.startTime) / 1000;

    console.log(`\n===============================================================`);
    console.log(`🏁 SHIPCORE PERFORMANCE DIAGNOSTICS`);
    console.log(`===============================================================`);
    console.log(`⏱️  Total Job Duration:   ${totalDuration.toFixed(3)} seconds`);
    console.log(`📦 Deliveries Processed: ${processedCount}`);
    console.log(`🔄 Network Round Trips:  ${PERFORMANCE.roundTrips}`);

    console.log(`\n--- Service Breakdown ---`);
    console.table(Object.entries(PERFORMANCE.apiStats).map(([service, stats]) => ({
        Service: service,
        'Calls': stats.count,
        'Avg Latency (ms)': stats.count > 0 ? (stats.totalMs / stats.count).toFixed(0) : 0
    })));
    console.log(`===============================================================`);
}

// --- 6. MAPPING ENGINE (FULL FIELD MAPPING) ---

function mapS4ToShipCore(s4, so) {

    const s4Hus = s4.to_HandlingUnitHeaderDelivery?.results || [];

    // --- PARTNER MERGE ---
    const s4Partners = (s4.to_DeliveryDocumentPartner?.results || []).map(p => ({
        role: p.PartnerFunction,
        id: p.Customer || p.Supplier || p.Personnel,
        name: p.to_Address?.FullName || p.to_Address?.BusinessPartnerName1 || "",
        address: {
            street: p.to_Address?.StreetName || "",
            city: p.to_Address?.CityName || "",
            country: p.to_Address?.Country || "",
            postalCode: p.to_Address?.PostalCode || ""
        }
    }));

    // Backfill from SO
    if (so && so._Partner) {
        so._Partner.forEach(soP => {
            if (!s4Partners.some(s4P => s4P.role === soP.PartnerFunction)) {
                s4Partners.push({
                    role: soP.PartnerFunction,
                    id: soP.Customer || soP.Supplier,
                    name: soP.BusinessPartnerName1 || "",
                    address: {
                        street: soP.StreetName || "",
                        city: soP.CityName || "",
                        country: soP.Country || "",
                        postalCode: soP.PostalCode || ""
                    }
                });
            }
        });
    }

    return {
        // --- HEADER ---
        header: {
            transactionId: `TXN-${Date.now()}`,
            deliveryId: s4.DeliveryDocument,
            warehouseId: s4.to_DeliveryDocumentItem?.results?.[0]?.Plant || "",
            deliveryType: s4.DeliveryDocumentType,
            shippingPoint: s4.ShippingPoint,
            shipDate: s4.DeliveryDate,

            // S/4 Header Statuses
            overallPickingStatus: s4.OverallPickingStatus,
            overallPackingStatus: s4.OverallPackingStatus,
            overallGoodsIssueStatus: s4.OverallGoodsMovementStatus,

            // Sales Order Data
            SalesOrganization: s4.SalesOrganization,
            TotalNetAmount: so ? so.TotalNetAmount : 0.00,
            TransactionCurrency: so ? so.TransactionCurrency : s4.TransactionCurrency,

            // Weights
            grossWeight: s4.HeaderGrossWeight,
            netWeight: s4.HeaderNetWeight,
            weightUnit: s4.HeaderWeightUnit,
            volume: s4.HeaderVolume,
            volumeUnit: s4.HeaderVolumeUnit
        },

        // --- PARTNERS ---
        partners: s4Partners,

        // --- MATERIALS (Full Delivery Item Fields) ---
        materials: (s4.to_DeliveryDocumentItem?.results || []).map(item => ({
            BaseUnit: item.BaseUnit,
            ActualDeliveredQtyInBaseUnit: item.ActualDeliveredQtyInBaseUnit,
            ActualDeliveryQuantity: item.ActualDeliveryQuantity,
            DeliveryDocument: item.DeliveryDocument,
            DeliveryDocumentItem: item.DeliveryDocumentItem,
            DeliveryDocumentItemCategory: item.DeliveryDocumentItemCategory,
            DeliveryQuantityUnit: item.DeliveryQuantityUnit,
            HigherLvlItmOfBatSpltItm: item.HigherLvlItmOfBatSpltItm,
            HigherLevelItem: item.HigherLevelItem,
            ItemGrossWeight: item.ItemGrossWeight,
            ItemNetWeight: item.ItemNetWeight,
            ItemVolume: item.ItemVolume,
            ItemVolumeUnit: item.ItemVolumeUnit,
            ItemWeightUnit: item.ItemWeightUnit,
            Material: item.Material,
            MaterialFreightGroup: item.MaterialFreightGroup,
            MaterialGroup: item.MaterialGroup,
            MaterialIsBatchManaged: item.MaterialIsBatchManaged,
            MaterialIsIntBatchManaged: item.MaterialIsIntBatchManaged,
            NumberOfSerialNumbers: item.NumberOfSerialNumbers,
            PickingStatus: item.PickingStatus,
            Plant: item.Plant,
            PackingStatus: item.PackingStatus,
            ReferenceSDDocument: item.ReferenceSDDocument,
            ReferenceSDDocumentCategory: item.ReferenceSDDocumentCategory,
            ReferenceSDDocumentItem: item.ReferenceSDDocumentItem,
            Batch: item.Batch,
            Description: item.DeliveryDocumentItemText,
            StorageLocation: item.StorageLocation
        })),

        // --- PACKAGES (Full HU Header Fields) ---
        packages: s4Hus.map(hu => ({
            DeliveryDocument: hu.DeliveryDocument,
            HandlingUnitExternalID: hu.HandlingUnitExternalId,
            HandlingUnitInternalID: hu.HandlingUnitInternalId,
            PackagingMaterial: hu.PackagingMaterial,
            PackagingMaterialType: hu.PackagingMaterialType,
            GrossVolume: hu.GrossVolume,
            GrossWeight: hu.GrossWeight,
            HandlingUnitHeight: hu.HandlingUnitHeight,
            HandlingUnitLength: hu.HandlingUnitLength,
            HandlingUnitUoMDimension: hu.HandlingUnitUoMDimension,
            HandlingUnitWidth: hu.HandlingUnitWidth,
            NetWeight: hu.NetWeight,
            ShippingPoint: hu.ShippingPoint,
            VolumeUnit: hu.VolumeUnit,
            WeightUnit: hu.WeightUnit,
            HandlingUnitLowerLevelRefer: hu.HandlingUnitLowerLevelRefer,

            // --- PACKED ITEMS (Full HU Item Fields) ---
            packedItems: (hu.to_HandlingUnitItemDelivery?.results || []).map(hi => ({
                Batch: hi.Batch,
                DeliveryDocument: hi.DeliveryDocument,
                DeliveryDocumentItem: hi.DeliveryDocumentItem,
                HandlingUnitExternalId: hi.HandlingUnitExternalId,
                HandlingUnitInternalId: hi.HandlingUnitInternalId,
                HandlingUnitItem: hi.HandlingUnitItem,
                HandlingUnitNestedInternalId: hi.HandlingUnitNestedInternalId,
                HandlingUnitNrOfAuxPackgMat: hi.HandlingUnitNrOfAuxPackgMat,
                HandlingUnitNumberOfSerialnumb: hi.HandlingUnitNumberOfSerialnumb,
                HandlingUnitQuantity: hi.HandlingUnitQuantity,
                HandlingUnitQuantityUnit: hi.HandlingUnitQuantityUnit,
                HandlingUnitTypeOfContent: hi.HandlingUnitTypeOfContent,
                Material: hi.Material,
                MaterialByCustomer: hi.MaterialByCustomer,
                MaterialName: hi.MaterialName,
                SerialNumberProfile: hi.SerialNumberProfile
            }))
        }))
    };
}

module.exports = { runbulks4ShipCoreJob }
