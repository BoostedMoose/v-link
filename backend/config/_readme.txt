/* VOLVO EXTENDED FRAME */

//////////////////////////////////////////////////////////////////////////////////////////
/*                                                                                      */
/*  Message Format:                                                                     */
/*  000FFFFE FF FF FF FF FF FF FF FF                                                    */
/*     |     |  |  |  |  |  |  '--'---- Padding                                         */
/*     |     |  |  |  |  |  '---------- Number of responses expected (query only)       */
/*     |     |  |  |  |  |                                                              */
/*     |     |  |  |  '--'------------- Parameter                                       */
/*     |     |  |  '------------------- Command                                         */
/*     |     |  '---------------------- Target ECU address                              */
/*     |     '------------------------- Message-length (always C8 + message content)    */
/*     '------------------------------- Arbitration ID                                  */
/*                                                                                      */
//////////////////////////////////////////////////////////////////////////////////////////


//  Template:
//
//  "boost": {
//      interface: "can0",                  // CAN bus interface
//      parameter: ['12', '9D'],            // Request parameter
//      app_id: "map:",                     // Internal identifier for V-Link app
//      req_id: req_id[0],                  // ID for the request message
//      rep_id: rep_id[0],                  // ID for the expected reply
//      action: command[3],                 // Type of operation
//      target: target_id[0],               // Target ECU
//      is_16bit: false,                    // 8Bit or 16Bit response value
//      refresh_rate: 0.02,                 // How much time to wait to send message again (seconds)
//      scale: '((value - 101.0) * 0.01)',  // Formula to scale the response

//      label: "Boost",                     // Label for V-Link app
//      max_value: 2,                       // Expected max. value for gauge setup
//      limit_start: 1.5,                   // Start of redline for gauge setup
//  },





/* STANDARD UDS PROTOCOL */

//////////////////////////////////////////////////////////////////////////////////////////
/*                                                                                      */
/*  Message Format:                                                                     */
/*  7E0 22 F4 0C 00 00 00 00 00                                                         */
/*   |  |  |  |  |  |  |  |  |                                                          */
/*   |  |  |  |  |  |  |  |  |                                                          */
/*   |  |  |  |  '--'--'--'--'--------- Padding                                         */
/*   |  |  '--'------------------------ Parameter                                       */
/*   |  '------------------------------ Command                                         */
/*   '--------------------------------- Arbitration ID                                  */
/*                                                                                      */
//////////////////////////////////////////////////////////////////////////////////////////


//  Template:
//
//  "boost": {
//      interface: "can0",                  // CAN bus interface
//      parameter: ['12', '9D'],            // Request parameter
//      app_id: "map:",                     // Internal identifier for V-Link app
//      req_id: req_id[0],                  // ID for the request message
//      rep_id: rep_id[0],                  // ID for the expected reply
//      action: command[3],                 // Type of operation
//      target: target_id[0],               // Target ECU
//      is_16bit: false,                    // 8Bit or 16Bit response value
//      refresh_rate: 0.02,                 // How much time to wait to send message again (seconds)
//      scale: '((value - 101.0) * 0.01)',  // Formula to scale the response

//      label: "Boost",                     // Label for V-Link app
//      max_value: 2,                       // Expected max. value for gauge setup
//      limit_start: 1.5,                   // Start of redline for gauge setup
//  },