const swaggerJsDoc = require('swagger-jsdoc');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Shipping Multi-Carrier API',
      version: '2.0.0',
      description: 'Unified Shipping API for Ship, RateAll, Track, Address validations and Void (Multi Carrier)',
    },
    servers: [
      {
        url: '/api',
        description: 'Current server',
      },
    ],
    components: {
      schemas: {
        /* ===========================
           Ship REQUEST WRAPPER
        ============================ */
        ShipRequest: {
          type: 'object',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                HEADER_INFO: { $ref: '#/components/schemas/HeaderInfo' },
                SHIPPER: { $ref: '#/components/schemas/AddressInfo' },
                SHIPTO: { $ref: '#/components/schemas/AddressInfo' },
                BILLTO: { $ref: '#/components/schemas/AddressInfo' },
                SHIPFROM: { $ref: '#/components/schemas/AddressInfo' },
                SOLDTO: { $ref: '#/components/schemas/AddressInfo' },
                ALTERNATE_ADDRESS: { $ref: '#/components/schemas/AddressInfo' },
                HOLD_AT_LOCATION: { $ref: '#/components/schemas/HoldAtLocation' },
                CARRIER_DETAILS: {
                  $ref: '#/components/schemas/Ship_CarrierDetails'
                },

                PACKAGES: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Package' }
                },

                SHIPMENT_LVL_SPECIAL_SERVICES: {
                  $ref: '#/components/schemas/Ship_SpecialServices'
                },

                INTERNATIONAL_DETAILS: {
                  $ref: '#/components/schemas/InternationalDetails'
                }
              }
            }
          }
        },
        //Ship Response//

        ShipResponse: {
          type: 'object',
          properties: {
            RESPONSE: {
              type: 'object',
              properties: {
                STATUS: { type: 'string' },
                TRACKING_STATUS: { type: 'string' },
                CARRIER: { type: 'string' },
                ACCOUNT_NUMBER: { type: 'string' },
                SERVICE_CODE: { type: 'string' },
                SERVICE_NAME: { type: 'string' },
                DISCOUNTED_FREIGHT: { type: 'string' },
                PUBLISHED_FREIGHT: { type: 'string' },
                EXPECTED_DELIVERY_DATE: { type: 'string' },
                TRANSIT_DAYS: { type: 'string' },
                CURRENCY: { type: 'string' },
                PACKAGES: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      TRACKING_NUMBER: { type: 'string' }
                    }
                  }
                },
                CHARGE_DETAILS: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      CHARGE_CODE: { type: 'string' },
                      SAP_CHARGE_CODE: { type: 'string', nullable: true },
                      DESCRIPTION: { type: 'string' },
                      AMOUNT: { type: 'number' },
                      CURRENCY: { type: 'string' }
                    }
                  }
                },

                SHIPPING_DOCUMENTS: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      DOC_PROVIDER: { type: 'string' },
                      CONTENT_TYPE: { type: 'string' },
                      COPIES_TO_PRINT: { type: 'integer' },
                      DOC_NAME: { type: 'string' },
                      ENCODED_LABEL: { type: 'string' },
                      DOC_TYPE: { type: 'string' }
                    }
                  }
                },

                ERRORS: {
                  type: 'array',
                  items: { type: 'string' }
                },

                HEADER_INFO: {
                  allOf: [
                    { $ref: '#/components/schemas/HeaderInfo' },
                    {
                      type: 'object',
                      properties: {
                        MASTER_TRACKING_NUMBER: { type: 'string' }
                      }
                    }
                  ]
                }
              }
            }
          }
        },

        /* ===========================
        Rate REQUEST WRAPPER
        ============================ */
        RateAllRequest: {
          type: 'object',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                HEADER_INFO: { $ref: '#/components/schemas/HeaderInfo' },
                SHIPPER: { $ref: '#/components/schemas/AddressInfo' },
                SHIPTO: { $ref: '#/components/schemas/AddressInfo' },
                SHIPFROM: { $ref: '#/components/schemas/AddressInfo' },
                SOLDTO: { $ref: '#/components/schemas/AddressInfo' },
                CARRIER_DETAILS: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Rate_CarrierDetails' }
                },

                PACKAGES: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Package' }
                },

                SHIPMENT_LVL_SPECIAL_SERVICES: {
                  $ref: '#/components/schemas/Ship_SpecialServices'
                },

                INTERNATIONAL_DETAILS: {
                  $ref: '#/components/schemas/InternationalDetails'
                }
              }
            }
          }
        },
        //Rate Response//
        RateAllResponse: {
          type: 'object',
          properties: {
            RESPONSE: {
              type: 'object',
              properties: {

                RATE_SERVICES: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      CARRIER: { type: 'string' },
                      ACCOUNT_NUMBER: { type: 'string' },
                      SERVICE_CODE: { type: 'string' },
                      SERVICE_NAME: { type: 'string' },
                      DISCOUNTED_FREIGHT: { type: 'string' },
                      PUBLISHED_FREIGHT: { type: 'string' },
                      EXPECTED_DELIVERY_DATE: { type: 'string' },
                      TRANSIT_DAYS: { type: 'string' },
                      CURRENCY: { type: 'string' },

                      CHARGE_DETAILS: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            CHARGE_CODE: { type: 'string' },
                            SAP_CHARGE_CODE: { type: 'string', nullable: true },
                            DESCRIPTION: { type: 'string' },
                            AMOUNT: { type: 'number' },
                            CURRENCY: { type: 'string' }
                          }
                        }
                      }
                    }
                  }
                },

                ERRORS: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        },

        //   TRACK REQUEST

        TrackRequest: {
          type: 'object',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                CARRIER_DETAILS: {
                  $ref: '#/components/schemas/Track_CarrierDetails'
                },
                PACKAGES: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/TPackage'
                  }
                }
              },
              required: ['CARRIER_DETAILS', 'PACKAGES']
            }
          },
          required: ['REQUEST']
        },

        // Track Response


        TrackResponse: {
          type: 'object',
          properties: {
            RESPONSE: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  TRACKING_NUMBER: { type: 'string' },
                  EXPECTED_DELIVERY_DATE: { type: 'string' },
                  ORIGIN: { $ref: '#/components/schemas/TrackLocation' },
                  DESTINATION: { $ref: '#/components/schemas/TrackLocation' },
                  EVENTS: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        TRACKING_NUMBER: { type: 'string' },
                        STATUS: { type: 'string' },
                        STATUS_CODE: { type: 'string' },
                        DATE_TIME: { type: 'string', nullable: true },

                        LOCATION: {
                          type: 'object',
                          properties: {
                            CITY: { type: 'string' },
                            STATE: { type: 'string' },
                            POSTAL_CODE: { type: 'string' },
                            COUNTRY: { type: 'string' },
                            LATITUDE: { type: 'string' },
                            LONGITUDE: { type: 'string' }
                          }
                        }
                      }
                    }
                  },

                  POD: { type: 'string' },

                  ERRORS: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                }
              }
            }
          }
        },

        // Void REQUEST

        CancelRequest: {
          type: 'object',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                HEADER_INFO: { $ref: '#/components/schemas/HeaderInfo' },
                CARRIER_DETAILS: { $ref: '#/components/schemas/Void_CarrierDetails' },
                PACKAGES: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TPackage' }
                }
              },
              required: ['CARRIER_DETAILS', 'PACKAGES']
            }
          },
          required: ['REQUEST']
        },

        // Void Response

        CancelResponse: {
          type: 'object',
          properties: {
            RESPONSE: {
              type: 'object',
              properties: {
                STATUS: { type: 'string' },
                TRACKING_NUMBER: { type: 'string' },
                ERRORS: {
                  type: 'array',
                  items: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        /* ===========================
          Address validate request
       ============================ */
        AddressRequest: {
          type: 'object',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                CARRIER_DETAILS: {
                  $ref: '#/components/schemas/CarrierDetails'
                },
                SHIPTO: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/AddressInfo'
                  }
                }
              },
              required: ['CARRIER_DETAILS', 'PACKAGES']
            }
          },
          required: ['REQUEST']
        },

        // Address validate Response

        AddressResponse: {
          type: 'object',
          properties: {
            RESPONSE: {
              type: 'object',
              properties: {
                VERIFIEDADDRESS: {
                  $ref: '#/components/schemas/ValidAddressInfo'
                },
                ERRORS: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        },


        GetShipRequest: {
          type: 'object',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                DELIVERY_NUMBERS: {
                  type: 'array',
                  items: {
                    type: 'string',
                    example: '0080019009'
                  }
                },
                TRACKING_NUMBERS: {
                  type: 'array',
                  items: {
                    type: 'string',
                    example: '0080019009'
                  }
                }
              },
              anyOf: [
                { required: ['DELIVERY_NUMBERS'] },
                { required: ['TRACKING_NUMBERS'] }
              ]
            }
          },
          required: ['REQUEST']
        },

        GetShipResponse: {
          type: 'array',
          properties: {
            RESPONSE: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                STATUS: { type: 'string' },
                TRACKING_STATUS: { type: 'string' },
                PACKAGES: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      TRACKING_NUMBER: { type: 'string' }
                    }
                  }
                },
                SHIPPING_CHARGES: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      DESCRIPTION: { type: 'string' },
                      AMOUNT: { type: 'number' },
                      CURRENCY: { type: 'string' }
                    }
                  }
                },

                SHIPPING_DOCUMENTS: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      DOC_PROVIDER: { type: 'string' },
                      CONTENT_TYPE: { type: 'string' },
                      COPIES_TO_PRINT: { type: 'integer' },
                      DOC_NAME: { type: 'string' },
                      ENCODED_LABEL: { type: 'string' },
                      DOC_TYPE: { type: 'string' }
                    }
                  }
                },

                ERRORS: {
                  type: 'array',
                  items: { type: 'string' }
                },

                HEADER_INFO: {
                  $ref: '#/components/schemas/HeaderInfo'
                }
              }
            }
          },
          required: ['REQUEST']
        },

        //Sub Infos

        HeaderInfo: {
          type: 'object',
          properties: {
            FEEDER_SYSTEM: { type: 'string' },
            DOCUMENT_NUMBER: { type: 'string' },
            DOCUMENT_TYPE: { type: 'string' },
            SHIP_DATE: { type: 'string', format: 'date-time' },
            SHIPMENT_TYPE: { type: 'string' },
            PACKAGING_TYPE: { type: 'string' },
            DROPOFF_TYPE: { type: 'string' },
            PICKUP_TYPE: { type: 'string' },
            LOCATION: { type: 'string' },
            ERP: { type: 'string' },
            TOTAL_WEIGHT: { type: 'string' },
            TOTAL_DIMENSION: { type: 'string' },
            IS_DUTIABLE: { type: 'string' },
            PO_NUMBER: { type: 'string' },
            INVOICE_NUMBER: { type: 'string' },
            CUSTOMER_REFERENCE: { type: 'string' },
            NOTES: { type: 'string' },
          }
        },

        AddressInfo: {
          type: 'object',
          properties: {
            COMPANY: { type: 'string' },
            CONTACT: { type: 'string' },
            ADDRESS_LINE1: { type: 'string' },
            ADDRESS_LINE2: { type: 'string' },
            ADDRESS_LINE3: { type: 'string' },
            CITY: { type: 'string' },
            STATE: { type: 'string' },
            ZIPCODE: { type: 'string' },
            COUNTRY: { type: 'string' },
            PHONE: { type: 'string' },
            EMAIL: { type: 'string', format: 'email' },
            ADDRESS_TYPE: { type: 'string', enum: ['RESIDENTIAL', 'NONRESIDENTIAL'] },
            TAXID: { type: 'string' },
            EORI: { type: 'string' },
            VAT: { type: 'string' },
          }
        },


        ValidAddressInfo: {
          type: 'object',
          properties: {
            COMPANY: { type: 'string' },
            CONTACT: { type: 'string' },
            ADDRESS_LINE1: { type: 'string' },
            ADDRESS_LINE2: { type: 'string' },
            CITY: { type: 'string' },
            STATE: { type: 'string' },
            ZIPCODE: { type: 'string' },
            COUNTRY: { type: 'string' },
            PHONE: { type: 'string' },
            EMAIL: { type: 'string', format: 'email' },
            ADDRESS_TYPE: { type: 'string', enum: ['RESIDENTIAL', 'NONRESIDENTIAL'] },
            CLASSIFICATION: { type: 'string' },
            RESOLVED: { type: 'string' },
            NOTE: { type: 'string' }
          }
        },
        Ship_CarrierDetails: {
          type: 'object',
          properties: {
            CARRIER: {
              type: 'string',
              enum: ['FEDEX', 'UPS', 'DHL', 'DHLGF', 'USPS', 'CANADAPOST', 'PUROLATOR', 'ODFL', 'ESTES', 'FEDEXFRT', 'SAIA', 'ABF', 'RL', 'SEFL']
            },
            INTEGRATION_TYPE: {
              type: 'string',
              enum: ['API', 'EDI'],
              description: 'Dispatch flag. For DHLGF: API → carriers/dhlgf/ship.js (REST), EDI → carriers/dhlgf/ediship.js (X12 4010 EDI 204 Motor Carrier Load Tender). Defaults to API.'
            },
            SERVICE_NAME: {
              type: 'string',
              description: 'Carrier specific service names. Example: FedEx Ground, UPS Ground, PRIORITY MAIL, Standard'
            },
            SERVICE_CODE: {
              type: 'string',

              description: `
      Services that can be requested for a potential shipment.

      Valid Values:

                 FedEx :

 
- INTERNATIONAL_FIRST:             FedEx International First®  
- FEDEX_INTERNATIONAL_PRIORITY:    FedEx International Priority®  
- INTERNATIONAL_ECONOMY:           FedEx International Economy®  
- FEDEX_GROUND:                    FedEx Domestic/International Ground®  
- FIRST_OVERNIGHT:                 FedEx First Overnight®  
- GROUND_HOME_DELIVERY:            FedEx Home Delivery®  
- SMART_POST:                      FedEx Ground® Economy (Formerly SmartPost®)  
- PRIORITY_OVERNIGHT:              FedEx Priority Overnight®  
- STANDARD_OVERNIGHT:              FedEx Standard Overnight® 
                                   (Hawaii outbound only)  
- FEDEX_2_DAY:                     FedEx 2Day® (Except Intra-Hawaii) 
- FEDEX_2_DAY_AM:                  FedEx 2Day® AM (Hawaii outbound only)  
- SAME_DAY:                        FedEx SameDay®  
- SAME_DAY_CITY:                   FedEx SameDay® City 
                                   (Selected U.S. Metro Areas)
- FEDEX_FIRST_FREIGHT:             FedEx First Overnight® Freight  
- FEDEX_1_DAY_FREIGHT:             FedEx 1Day® Freight (Hawaii: Oahu only)  
- FEDEX_2_DAY_FREIGHT:             FedEx 2Day® Freight (Hawaii: Oahu only)  
- FEDEX_3_DAY_FREIGHT:             FedEx 3Day® Freight (Except Alaska & Hawaii)  
- INTERNATIONAL_PRIORITY_FREIGHT:  FedEx International Priority® Freight  
- INTERNATIONAL_ECONOMY_FREIGHT:   FedEx International Economy® Freight  
- FEDEX_INTERNATIONAL_CONNECT_PLUS:FedEx International Connect Plus®  
- FEDEX_INTERNATIONAL_DEFERRED_FREIGHT:
  FedEx® International Deferred Freight  
- INTERNATIONAL_PRIORITY_DISTRIBUTION:    
  FedEx International Priority DirectDistribution®  
- INTERNATIONAL_DISTRIBUTION_FREIGHT:    
  FedEx International Priority DirectDistribution® Freight  
- INTL_GROUND_DISTRIBUTION:   International Ground® Distribution (IGD)
- FEDEX_EXPRESS_SAVER:    FedEx Express Saver® (Except Alaska & Hawaii)
- FEDEX_INTERNATIONAL_PRIORITY_EXPRESS:    FedEx International Priority® Express 
                
       --FedEx Freight
                
- FEDEX_FREIGHT_PRIORITY:          FedEx LTL Freight Priority  
- FEDEX_FREIGHT_ECONOMY:           FedEx LTL Freight Economy  

                ----  LTL ----
                 STD: Standard,
                GSDS: Guaranteed,
                GSHW: GuaranteedHourlyWindow,
                GSAM: GuaranteedByNoon,
                EXPD: Expedited
                
                ----  UPS ----
                03: UPS Ground,
                01: UPS Next Day Air,
                02: UPS 2nd Day Air,
                07: UPS Worldwide Express,
                08: UPS Worldwide Expedited,
                11: UPS Standard,
                12: UPS 3 Day Select,
                13: UPS Next Day Air Saver,
                14: UPS Next Day Air Early,
                17: UPS® Worldwide Economy DDU,
                54: UPS Worldwide Express Plus,
                59: UPS 2nd Day Air A.M.,
                65: UPS Worldwide Saver,
                M2: UPS First-Class Mail,
                M3: UPS Priority Mail
                `,
              example: 'FEDEX_GROUND'
            },
            USERID: { type: 'string' },
            PASSWORD: { type: 'string' },
            SHIPPING_ACCOUNT: { type: 'string' },
            PAYMENT_TYPE: { type: 'string' },
            PAYMENT_TERMS: { type: 'string' },
            ROLE: { type: 'string' },
            BILLING_ACCOUNT: { type: 'string' },
            BILLING_ZIPCODE: { type: 'string' },
            BILLING_COUNTRY: { type: 'string' },
            LABEL_TYPE: { type: 'string' },
            ACCESS_KEY: { type: 'string' },
            TOKENURL: { type: 'string' },
            RATEURL: { type: 'string' },
            SHIPURL: { type: 'string' },
            LABELURL: { type: 'string' },
            RATE_KEY: { type: 'string' },
            SHIP_KEY: { type: 'string' },
            LABEL_KEY: { type: 'string' },
          },
          required: ['CARRIER', 'SHIPPING_ACCOUNT', 'SERVICE_CODE']
        },

        Rate_CarrierDetails: {
          type: 'object',
          properties: {
            CARRIER: {
              type: 'string',
              enum: ['FEDEX', 'UPS', 'DHL', 'DHLGF', 'USPS', 'CANADAPOST', 'PUROLATOR', 'ODFL', 'ESTES', 'FEDEXFRT', 'SAIA', 'ABF', 'RL', 'SEFL']
            },
            USERID: { type: 'string' },
            PASSWORD: { type: 'string' },
            SHIPPING_ACCOUNT: { type: 'string' },
            ACCESS_KEY: { type: 'string' },
            RATE_KEY: { type: 'string' },
            TOKENURL: { type: 'string' },
            RATEURL: { type: 'string' },

          },
          required: ['CARRIER', 'SHIPPING_ACCOUNT']
        },

        Void_CarrierDetails: {
          type: 'object',
          properties: {
            CARRIER: { type: 'string' },
            SHIPPING_ACCOUNT: { type: 'string' },
            USERID: { type: 'string' },
            PASSWORD: { type: 'string' },
            ACCESS_KEY: { type: 'string' },
            CANCEL_KEY: { type: 'string' },
            TOKENURL: { type: 'string' },
            VOIDURL: { type: 'string' },

          }
        },
        Track_CarrierDetails: {
          type: 'object',
          properties: {
            CARRIER: { type: 'string' },
            SHIPPING_ACCOUNT: { type: 'string' },
            USERID: { type: 'string' },
            PASSWORD: { type: 'string' },
            ACCESS_KEY: { type: 'string' },
            TRACK_KEY: { type: 'string' },
            TOKENURL: { type: 'string' },
            TRACKURL: { type: 'string' },
          }
        },

        Package: {
          type: 'object',
          properties: {
            DESCRIPTION: { type: 'string' },
            WEIGHT: { type: 'string' },
            WEIGHT_UNITS: { type: 'string', enum: ['LB', 'KG'] },
            DIMENSION: { type: 'string' },
            DIMENSION_UNITS: { type: 'string', enum: ['IN', 'CM'] },
            SNO: { type: 'string' },
            HU_NO: { type: 'string' },
            LTL_CLASS: { type: 'string' },
            HANDLING_UNIT_TYPE: { type: 'string' },
            ITEM_PACKING_TYPE: { type: 'string' },
            QUANTITY: { type: 'integer' },
            DECLARED_VALUE: { type: 'string' },
            ITEM_INFO: {
              type: 'array',
              items: { $ref: '#/components/schemas/PackItems' }
            },
            PACKAGE_LVL_SPECIAL_SERVICES: {
              $ref: '#/components/schemas/Pack_SpecialServices'
            },
          }
        },

        PackItems: {
          type: 'object',
          properties: {
            ITEM_NO: { type: 'string' },
            SNO: { type: 'string' },
            DESCRIPTION: { type: 'string' },
            ITEM_WEIGHT: { type: 'string' }, //Total weight for the specified lineItem.
            LTL_CLASS: { type: 'string' },
            QUANTITY: { type: 'string' }, //Number of individual pieces for the line item being described
            ITEM_PACKING_TYPE: { type: 'string' },//Packaging type for the individual pieces
            ITEM_DIMENSION: { type: 'string' }
            //PIECES: { type: 'string' } //Number of individual pieces for the line item being described
          }
        },
        TPackage: {
          type: 'object',
          properties: {
            TRACKING_NUMBER: { type: 'string' }
          }
        },

        Ship_SpecialServices: {
          type: 'object',
          properties: {
            /* ================= BASIC FLAGS ================= */


            THIRD_PARTY_CONSIGNEE: { type: 'boolean' },
            FEDEX_ONE_RATE: { type: 'boolean' },
            RESIDENTIAL_DELIVERY: { type: 'boolean' },
            SATURDAY_DELIVERY: { type: 'boolean' },
            TRADE_SHOW_DELIVERY: { type: 'boolean' },
            INSIDE_DELIVERY: { type: 'boolean' },
            GUARANTEED_DELIVERY: { type: 'boolean' },
            EXHIBITION_DELIVERY: { type: 'boolean' },
            PHARMACY_DELIVERY: { type: 'boolean' },
            LIFT_GATE_DELIVERY: { type: 'boolean' },
            AIRPORT_DELIVERY: { type: 'boolean' },
            DELIVERY_APPOINTMENT: { type: 'boolean' },
            DELIVERY_NOTIFICATION: { type: 'boolean' },
            HOLIDAY_DELIVERY: { type: 'boolean' },
            LIMITED_ACCESS_DELIVERY: { type: 'boolean' },
            CONSTRUCTION_SITE_DELIVERY: { type: 'boolean' },
            NON_COMMERCIAL_PICKUP_DELIVERY: { type: 'boolean' },
            CONVENTION_CENTER_DELIVERY: { type: 'boolean' },
            NEUTRAL_DELIVERY: { type: 'boolean' },
            DROPOFF_AT_FACILITY: { type: 'boolean' },
            EXCHANGE_FORWARD_SHIPMENT: { type: 'boolean' },
            INSIDE_PICKUP: { type: 'boolean' },
            RESIDENTIAL_PICKUP: { type: 'boolean' },
            SATURDAY_PICKUP: { type: 'boolean' },
            TRADE_SHOW_PICKUP: { type: 'boolean' },
            SORT_AND_SEGREGATE: { type: 'boolean' },
            SEG_PIECE_COUNT: { type: 'integer' },
            HAZMAT: { type: 'boolean' },
            HAZMAT_UNID_NUMBER: { type: 'string' },
            HAZMAT_DESC: { type: 'string' },
            HAZMAT_CONTACT: { type: 'string' },
            HAZMAT_PHONE: { type: 'string' },
            LIFT_GATE_PICKUP: { type: 'boolean' },

            AIRPORT_PICKUP: { type: 'boolean' },

            PICK_UP_APPOINTMENT: { type: 'boolean' },
            TIME_CRITICAL_APPOINTMENT: { type: 'boolean' },
            IN_BOND: { type: 'boolean' },
            OVER_LENGTH: { type: 'boolean' },
            CONSTRUCTION_SITE_PICKUP: { type: 'boolean' },
            HOLIDAY_PICKUP: { type: 'boolean' },
            LIMITED_ACCESS_PICKUP: { type: 'boolean' },

            PROTECT_FROM_FREEZING: { type: 'boolean' },
            SECURITY_INSPECTION: { type: 'boolean' },
            SINGLE_SHIPMENT: { type: 'boolean' },
            EXTREME_LENGTH: { type: 'boolean' },
            DO_NOT_STACK_PALLETS: { type: 'boolean' },
            DO_NOT_BREAK_PALLETS: { type: 'boolean' },
            FOOD: { type: 'boolean' },
            POISON: { type: 'boolean' },
            TOP_LOAD: { type: 'boolean' },
            SECURITY_INSPECTION: { type: 'boolean' },

            GO_GREEN_PLUS: { type: 'boolean' },

            INSURANCE_AMOUNT: { type: 'string' },
            INSURANCE_CURRENCY: { type: 'string' },
            ELECTRONIC_TRADE_DOCUMENT: { type: 'boolean' },
            ETD_DOCUMENTS: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  CONTENT_TYPE: { type: 'string' },
                  DOC_NAME: { type: 'string' },
                  ENCODED_DOC: { type: 'string' },
                  DOC_TYPE: { type: 'string' }
                }
              }
            },
            INDICIA: {
              type: 'string',
              enum: [
                'MEDIA_MAIL',
                'PARCEL_RETURN',
                'PARCEL_SELECT',
                'PRESORTED_BOUND_PRINTED_MATTER',
                'PRESORTED_STANDARD'
              ]
            },
            SIGNATURE_REQUIRED: { type: 'boolean' },
            CUSTOM_DELIVERY_WINDOW: { type: 'string' },
            SIGNATURE_OPTION_TYPE: {
              type: 'string',
              enum: ['ADULT', 'DIRECT', 'INDIRECT', 'NO_SIGNATURE_REQUIRED']
            },

            HOLD_AT_LOCATION: { type: 'boolean' },


            BROKER_SELECT: { type: 'boolean' },
            BROKER_ADDRESS: { $ref: '#/components/schemas/AddressInfo' },

            EMAIL_NOTIFICATION: { type: 'boolean' },
            EMAIL_NOTIFICATION: { $ref: '#/components/schemas/EmailNotification' },
            RETURN_SHIP: {
              $ref: '#/components/schemas/ReturnShip'
            },
            FREIGHT_GUARANTEE: {
              type: 'object',
              properties: {
                TYPE: {
                  type: 'string',
                  enum: [
                    'GUARANTEED_DATE',
                    'GUARANTEED_MORNING',
                    'GUARANTEED_TIME'
                  ]
                },
                DATE: { type: 'string' },
              }
            },
            FREIGHT_DIRECT: {
              type: 'object',
              properties: {
                TYPE: {
                  type: 'string',
                  enum: [
                    'BASIC',
                    'BASIC_BY_APPOINTMENT',
                    'PREMIUM',
                    'STANDARD'
                  ]
                },
                TRANSPORT_TYPE: {
                  type: 'string',
                  enum: ['DELIVERY', 'PICKUP']
                },
                PHONE: { type: 'string' },
                EMAIL: { type: 'string' }
              }
            },
            HOME_DELIVERY: {
              type: 'object',
              properties: {
                PREMIUM_TYPE: {
                  type: 'string',
                  enum: ['APPOINTMENT', 'DATE_CERTAIN', 'EVENING']
                },
                PHONE: { type: 'string' },
                AREA_CODE: { type: 'string' },
                DELIVERY_DATE: {
                  type: 'string',
                  format: 'date'
                }
              }
            },
            IMPORT_CONTROL: {
              type: 'object',
              properties: {
                CODE: {
                  type: 'string',
                  enum: [
                    ''
                  ]
                }
              }
            },
          }
        },

        Pack_SpecialServices: {
          type: 'object',
          properties: {
            PRIORITY_ALERT: { type: 'boolean' },
            PRIORITY_ALERT_PLUS: { type: 'boolean' },
            PRIORITY_ALERT_PLUS_CONTENT: { type: 'string', description: 'Specifies Content for the Priority Alert Detail.' },
            SATURDAY_PICKUP: { type: 'boolean' },
            SIGNATURE_REQUIRED: { type: 'boolean', description: 'For LTL carriers just required flag only' },
            SIGNATURE_OPTION_TYPE: {
              type: 'string',
              enum: ['ADULT', 'DIRECT', 'INDIRECT', 'NO_SIGNATURE_REQUIRED']
            },
            COD: {
              type: 'object',
              properties: {
                AMOUNT: { type: 'string' },
                CURRENCY: { type: 'string' },
                COLLECTION_TYPE: {
                  type: 'string',
                  description: 'UPS specific collection type'
                }
              }
            },
            DRY_ICE: {
              type: 'object',
              properties: {
                WEIGHT_UNITS: {
                  type: 'string',
                  enum: ['KG', 'LB']
                },
                WEIGHT: { type: 'string' },
                QUANTITY: { type: 'string' },
                REGULATION_SET: {
                  type: 'string',
                  enum: ['IATA', 'CFR']
                }
              }
            },
            ALCOHOL: {
              type: 'object',
              properties: {
                RECIPIENT_TYPE: {
                  type: 'string',
                  enum: ['LICENSEE', 'CONSUMER']
                },
                SHIPPER_AGREEMENT_TYPE: { type: 'string' }
              }
            },
            BATTERY: {
              type: 'object',
              properties: {
                PACKING_TYPE: {
                  type: 'string',
                  enum: [
                    'CONTAINED_IN_EQUIPMENT',
                    'PACKED_WITH_EQUIPMENT'
                  ]
                },
                REGULATORY_TYPE: {
                  type: 'string',
                  enum: [
                    'IATA_SECTION_I',
                    'IATA_SECTION_II'
                  ]
                },
                MATERIAL_TYPE: {
                  type: 'string',
                  enum: [
                    'LITHIUM_METAL',
                    'LITHIUM_ION'
                  ]
                }
              }
            },
            HAZMAT: {
              type: 'object',
              properties: {
                ACCESSIBILITY: {
                  type: 'string',
                  enum: ['ACCESSIBLE', 'INACCESSIBLE']
                },
                PACKAGING_TYPE_QUANTITY: { type: 'string' },
                SUB_CLASS: { type: 'string' },
                TECHNICAL_NAME: { type: 'string' },
                HAZ_CLASS: { type: 'string' },
                QUANTITY: { type: 'string' },
                WEIGHT: { type: 'string' },
                UOM: { type: 'string' },
                PACKAGING_TYPE: { type: 'string' },
                UNID_NUMBER: { type: 'string' },
                PROPER_SHIPPING_NAME: { type: 'string' },
                PACKAGING_GROUP_TYPE: { type: 'string' },
                PACKAGING_INSTRUCTION_CODE: { type: 'string' },
                EMERGENCY_PHONE: { type: 'string' },
                EMERGENCY_CONTACT: { type: 'string' },
                REGULATION_SET: {
                  type: 'string',
                  enum: ['IATA', 'CFR']
                },
                TRANSPORTATION_MODE: { type: 'string' },
                COMMODITY_REGULATED_LEVEL_CODE: { type: 'string' },
                TRANSPORT_CATEGORY: { type: 'string' },
                TUNNEL_RESTRICTION_CODE: { type: 'string' },
                CHEMICAL_RECORD_IDENTIFIER: { type: 'string' },
                CARGO_AIRCRAFT: { type: 'boolean' }
              }
            }
          }
        },
        InternationalDetails: {
          type: 'object',
          properties: {
            BOOKING_CONFIRM_NUMBER: { type: 'string' },
            DUTIES_PAYMENT_TYPE: { type: 'string' },
            DUTIES_ACCOUNT: { type: 'string' },
            B13_FILING_OPTION: { type: 'string' },
            ITN: { type: 'string' },
            CURRENCY: { type: 'string' },
            CUSTOMS_VALUE: { type: 'string' },
            CUSTOMS_VALUE_CURRENCY: { type: 'string' },
            INSURANCE_AMOUNT: { type: 'string' },
            INSURANCE_CURRENCY: { type: 'string' },
            INVOICE_NUMBER: { type: 'string' },
            INVOICE_DATE: { type: 'string' },
            EXPORT_STATEMENT: { type: 'string' },
            REASON_FOR_EXPORT: { type: 'string' },
            DOCUMENT_CONTENT: { type: 'string' },
            INCOTERMS: { type: 'string' }, //inco term or termsOfSale OR Terms of Shipment
            INCOTERMS_LOCATION: { type: 'string' },
            PAYMENT_TERMS: { type: 'string' },
            IMPORTER_ADDRESS: { $ref: '#/components/schemas/AddressInfo' },
            ITEM_INFO: {
              type: 'array',
              items: { $ref: '#/components/schemas/IntItems' }
            }

          }
        },

        IntItems: {
          type: 'object',
          properties: {
            ITEM_NO: { type: 'string' },
            PRODUCT_NO: { type: 'string' },
            DESCRIPTION: { type: 'string' },
            COUNTRY_OF_MFR: { type: 'string' },
            UNIT_COST: { type: 'string' },
            ITEM_WEIGHT: { type: 'string' },
            UOM: { type: 'string' },
            HTS_CODE: { type: 'string' },
            ECCN: { type: 'string' },
            SNO: { type: 'string' },
            QUANTITY: { type: 'string' },
            PIECES: { type: 'string' },
            IS_TAX_PAID: { type: 'boolean' }
          }
        },


        EmailNotification: {
          type: 'object',
          properties: {
            RECIPIENT_TYPES: {
              type: 'string',
              enum: ['SHIPPER', 'RECIPIENT']
            },
            EVENT_TYPE: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'ON_DELIVERY',
                  'ON_EXCEPTION',
                  'ON_SHIPMENT',
                  'ON_TENDER',
                  'ON_ESTIMATED_DELIVERY',
                  'ON_PICKUP_DRIVER_ARRIVED',
                  'ON_PICKUP_DRIVER_ASSIGNED',
                  'ON_PICKUP_DRIVER_DEPARTED',
                  'ON_PICKUP_DRIVER_EN_ROUTE'
                ]
              }
            },
            CONTACT: { type: 'string' },
            EMAIL: { type: 'string', format: 'email' }
          }
        },
        ReturnShip: {
          type: 'object',
          properties: {
            PHONE: { type: 'string' },
            REASON: { type: 'string' },
            SPECIAL_SERVICES: { type: 'string' },
            EXPIRY_DATE: { type: 'string', format: 'date' },
            RETURN_TYPE: {
              type: 'string',
              enum: ['PENDING', 'PRINT_RETURN_LABEL']
            },
            EMAIL: { type: 'string', format: 'email' },
            CUSTOMS_OPTION: { type: 'string' },
            TRACKING_NUMBER: { type: 'string' },
            SHIP_DATE: { type: 'string', format: 'date' }
          }
        },
        HoldAtLocation: {
          allOf: [
            { $ref: '#/components/schemas/AddressInfo' },
            {
              type: 'object',
              properties: {
                LOCATION_ID: { type: 'string' },
                LOCATION_TYPE: {
                  type: 'string',
                  enum: [
                    'FEDEX_AUTHORIZED_SHIP_CENTER',
                    'FEDEX_OFFICE',
                    'FEDEX_SELF_SERVICE_LOCATION',
                    'FEDEX_STAFFED',
                    'RETAIL_ALLICANCE_LOCATION',
                    'FEDEX_GROUND_TERMINAL',
                    'FEDEX_ONSITE'
                  ]
                }
              }
            }
          ]
        },

        TrackLocation: {
          type: 'object',
          properties: {
            CITY: { type: 'string' },
            STATE: { type: 'string' },
            POSTAL_CODE: { type: 'string' },
            COUNTRY: { type: 'string' }
          }
        },

        EDI_Envelope: {
          type: 'object',
          description: 'ISA / GS interchange envelope values used to build EDI 204 header.',
          properties: {
            ISA_SENDER_QUALIFIER:   { type: 'string', example: 'ZZ', description: 'ISA05 - Sender ID Qualifier (e.g. ZZ, 01, 14)' },
            ISA_SENDER_ID:          { type: 'string', example: 'PLUTOCLOUD',  description: 'ISA06 - Interchange Sender ID (15 chars, padded right)' },
            ISA_RECEIVER_QUALIFIER: { type: 'string', example: 'ZZ', description: 'ISA07 - Receiver ID Qualifier' },
            ISA_RECEIVER_ID:        { type: 'string', example: 'DHLGF',       description: 'ISA08 - Interchange Receiver ID (15 chars, padded right)' },
            ISA_CONTROL_NUMBER:     { type: 'string', example: '000000001',   description: 'ISA13 - Interchange Control Number (9 digits)' },
            USAGE_INDICATOR:        { type: 'string', enum: ['P', 'T'], example: 'T', description: 'ISA15 - P=Production, T=Test' },
            COMPONENT_SEPARATOR:    { type: 'string', example: '>', description: 'ISA16 - Component element separator' },
            ELEMENT_SEPARATOR:      { type: 'string', example: '*', description: 'Data element separator' },
            SEGMENT_TERMINATOR:     { type: 'string', example: '~', description: 'Segment terminator (commonly ~ or |)' },
            GS_SENDER_ID:           { type: 'string', example: 'PLUTOCLOUD', description: 'GS02 - Application Sender Code' },
            GS_RECEIVER_ID:         { type: 'string', example: 'DHLGF',      description: 'GS03 - Application Receiver Code' },
            GS_CONTROL_NUMBER:      { type: 'string', example: '1',           description: 'GS06 - Group Control Number' },
            INTERCHANGE_VERSION:    { type: 'string', example: '00401',       description: 'ISA12 - Interchange Version Number' },
            FUNCTIONAL_ID_CODE:     { type: 'string', example: 'SM',          description: 'GS01 - Functional ID. SM for 204' },
            VERSION_RELEASE:        { type: 'string', example: '004010',      description: 'GS08 - Version/Release/Industry ID' }
          }
        },

        EDI204_Header: {
          type: 'object',
          description: 'EDI 204 (Motor Carrier Load Tender) shipment header tags.',
          properties: {
            SHIPMENT_ID:                 { type: 'string', description: 'B204 - Shipment Identification Number' },
            PURPOSE_CODE:                { type: 'string', enum: ['00', '01', '04', '05'], description: 'B2A01 - 00=Original, 01=Cancel, 04=Change, 05=Replace' },
            STANDARD_CARRIER_ALPHA_CODE: { type: 'string', example: 'DHLG', description: 'B202 - SCAC code for carrier' },
            SHIPMENT_METHOD_OF_PAYMENT:  { type: 'string', enum: ['PP', 'CC', 'TP'], description: 'B207 - PP=Prepaid, CC=Collect, TP=Third Party' },
            SHIPMENT_QUALIFIER:          { type: 'string', description: 'B208 - Shipment qualifier (e.g. P=Partial, L=LTL)' },
            WEIGHT_UNIT:                 { type: 'string', enum: ['L', 'K'], description: 'L=Pounds, K=Kilograms' },
            VOLUME_UNIT:                 { type: 'string', enum: ['E', 'C'], description: 'E=Cubic Feet, C=Cubic Meters' },
            MODE_OF_TRANSPORT:           { type: 'string', example: 'M', description: 'M=Motor, A=Air, R=Rail, S=Ocean' },
            SERVICE_LEVEL_CODE:          { type: 'string', description: 'Service level code, e.g. STD, EXP' },
            EQUIPMENT_DESC_CODE:         { type: 'string', example: 'TL', description: 'N701 - Equipment Description Code (TL, CN, TF...)' },
            EQUIPMENT_NUMBER:            { type: 'string', description: 'N702 - Equipment / Trailer Number' },
            HAZMAT_FLAG:                 { type: 'boolean', description: 'Emit LH1/LH2/LH3 hazmat segments when true' },
            REFERENCE_NUMBERS: {
              type: 'array',
              description: 'L11 reference numbers (BM=BOL, CN=Carrier Reference, PO=Purchase Order, IT=Internal Tracking, ZZ=Mutually Defined)',
              items: {
                type: 'object',
                properties: {
                  QUALIFIER: { type: 'string', example: 'BM' },
                  VALUE:     { type: 'string' }
                }
              }
            }
          }
        },

        EDI204_Stop: {
          type: 'object',
          description: 'EDI 204 S5 stop-off detail (pickup/delivery point).',
          properties: {
            STOP_SEQUENCE: { type: 'integer', description: 'S501 - Stop Sequence Number' },
            STOP_REASON:   { type: 'string', enum: ['LD', 'UL', 'CL', 'CU'], description: 'S502 - LD=Load, UL=Unload, CL=Complete Load, CU=Complete Unload' },
            WEIGHT:        { type: 'string' },
            WEIGHT_UNIT:   { type: 'string', enum: ['L', 'K'] },
            VOLUME:        { type: 'string' },
            VOLUME_UNIT:   { type: 'string', enum: ['E', 'C'] },
            PIECES:        { type: 'integer' },
            STOP_DATE:     { type: 'string', format: 'date' },
            STOP_TIME:     { type: 'string', example: '0930' },
            ADDRESS:       { $ref: '#/components/schemas/AddressInfo' },
            NOTES:         { type: 'string' },
            ORDER_DETAILS: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ORDER_ID:    { type: 'string', description: 'OID02 - Reference identification' },
                  PIECES:      { type: 'integer' },
                  WEIGHT:      { type: 'string' },
                  WEIGHT_UNIT: { type: 'string', enum: ['L', 'K'] },
                  DESCRIPTION: { type: 'string' },
                  COMMODITY:   { type: 'string' }
                }
              }
            }
          }
        },

        EDI204Request: {
          type: 'object',
          description: 'Standard JSON payload used to build a DHL Global Forwarding EDI 204 (Motor Carrier Load Tender).',
          properties: {
            REQUEST: {
              type: 'object',
              properties: {
                EDI_ENVELOPE:    { $ref: '#/components/schemas/EDI_Envelope' },
                HEADER_INFO:     { $ref: '#/components/schemas/HeaderInfo' },
                EDI204_HEADER:   { $ref: '#/components/schemas/EDI204_Header' },
                CARRIER_DETAILS: { $ref: '#/components/schemas/Ship_CarrierDetails' },
                SHIPPER:         { $ref: '#/components/schemas/AddressInfo' },
                SHIPTO:          { $ref: '#/components/schemas/AddressInfo' },
                BILLTO:          { $ref: '#/components/schemas/AddressInfo' },
                SHIPFROM:        { $ref: '#/components/schemas/AddressInfo' },
                SOLDTO:          { $ref: '#/components/schemas/AddressInfo' },
                STOPS: {
                  type: 'array',
                  description: 'S5 stop-off loop (at least 2 stops: pickup + delivery)',
                  items: { $ref: '#/components/schemas/EDI204_Stop' }
                },
                PACKAGES: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Package' }
                }
              },
              required: ['EDI_ENVELOPE', 'EDI204_HEADER', 'SHIPPER', 'SHIPTO']
            }
          },
          required: ['REQUEST']
        },

        EDI204Response: {
          type: 'object',
          properties: {
            STATUS:           { type: 'string', example: 'Success' },
            CARRIER:          { type: 'string', example: 'DHLGF' },
            TRANSACTION_SET:  { type: 'string', example: '204' },
            CONTROL_NUMBER:   { type: 'string' },
            FILE_NAME:        { type: 'string' },
            EDI_PAYLOAD:      { type: 'string', description: 'Raw X12 4010 EDI 204 text' },
            ERRORS: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }

      }
    }
  },
  apis: ['./routes/*.js', './carriers/dhl/*.js'],
};

const swaggerSpec = swaggerJsDoc(swaggerOptions);

module.exports = swaggerSpec;
