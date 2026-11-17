// FIX 4.4 data dictionary: only the tags and MsgTypes the tradeBerry gateway/broker speak (design spec, "Contractul FIX 4.4").
// Tags are numbers here and strings in parsed messages (Map keys); TAG maps name -> number, NAME the reverse.
export const BEGIN_STRING = 'FIX.4.4';

// MsgType -> name. Session: A 0 1 2 3 4 5. Application: orders, reports, positions, collateral, trade capture.
export const MSG = {
  A: 'Logon', 0: 'Heartbeat', 1: 'TestRequest', 2: 'ResendRequest', 3: 'Reject', 4: 'SequenceReset', 5: 'Logout',
  D: 'NewOrderSingle', F: 'OrderCancelRequest', G: 'OrderCancelReplaceRequest', H: 'OrderStatusRequest', AF: 'OrderMassStatusRequest',
  8: 'ExecutionReport', 9: 'OrderCancelReject', j: 'BusinessMessageReject',
  AN: 'RequestForPositions', AO: 'RequestForPositionsAck', AP: 'PositionReport', BB: 'CollateralInquiry', BA: 'CollateralReport',
  AD: 'TradeCaptureReportRequest', AQ: 'TradeCaptureReportRequestAck', AE: 'TradeCaptureReport',
  U1: 'AccountSettings (temporary broker)', U2: 'RecordsRequest (temporary broker)', U3: 'Records (temporary broker)',
};
// the session-level types: handled by the session layer, never passed to the application
export const SESSION = new Set(['A', '0', '1', '2', '3', '4', '5']);

export const TAG = {
  // header and trailer
  BeginString: 8, BodyLength: 9, MsgType: 35, SenderCompID: 49, TargetCompID: 56, MsgSeqNum: 34, SendingTime: 52, PossDupFlag: 43, OrigSendingTime: 122, CheckSum: 10,
  // session
  EncryptMethod: 98, HeartBtInt: 108, Username: 553, Password: 554, ResetSeqNumFlag: 141, TestReqID: 112, BeginSeqNo: 7, EndSeqNo: 16,
  NewSeqNo: 36, GapFillFlag: 123, RefSeqNum: 45, RefTagID: 371, RefMsgType: 372, SessionRejectReason: 373, Text: 58,
  // orders
  ClOrdID: 11, OrigClOrdID: 41, Account: 1, Symbol: 55, Side: 54, TransactTime: 60, OrderQty: 38, OrdType: 40, Price: 44, StopPx: 99,
  TimeInForce: 59, ExpireTime: 126, MassStatusReqID: 584, MassStatusReqType: 585,
  // execution report
  OrderID: 37, ExecID: 17, ExecType: 150, OrdStatus: 39, LastPx: 31, LastQty: 32, CumQty: 14, LeavesQty: 151, AvgPx: 6, OrdRejReason: 103,
  CxlRejReason: 102, CxlRejResponseTo: 434, BusinessRejectReason: 380, BusinessRejectRefID: 379,
  // positions, collateral, trade capture
  PosReqID: 710, PosReqType: 724, SubscriptionRequestType: 263, ClearingBusinessDate: 715, PosMaintRptID: 721, SettlPrice: 730, TotalNumPosReports: 727, PosReqResult: 728, PosReqStatus: 729,
  NoPositions: 702, PosType: 703, LongQty: 704, ShortQty: 705, PosQtyStatus: 706,
  NoPosAmt: 753, PosAmtType: 707, PosAmt: 708,
  NoRelatedSym: 146,
  CollInquiryID: 909, CollRptID: 908, TotNumReports: 911, TradeRequestID: 568, TradeRequestType: 569, TradeReportID: 571, TotNumTradeReports: 748, TradeRequestResult: 749, TradeRequestStatus: 750, ExecRestatementReason: 378,
};
export const NAME = Object.fromEntries(Object.entries(TAG).map(([n, t]) => [t, n]));

// Repeating groups: count tag -> its members, the first being the one that starts every entry.
export const GROUPS = {
  702: [703, 704, 705, 706],
  753: [707, 708],
  146: [55, 65, 48, 22],
};
