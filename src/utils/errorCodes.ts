/**
 * EcoFlow Error Codes Database
 * Maps error codes to detailed descriptions, causes, solutions, and helpful links
 */

export interface ErrorCodeInfo {
  code: number | string;
  title: string;
  description: string;
  causes: string[];
  solutions: string[];
  youtubeUrl?: string;
  docsUrl?: string;
}

export type ErrorType = 'bms' | 'inv' | 'mppt' | 'overload' | 'ems' | 'battery';

// Generic fallback for unknown errors
const UNKNOWN_ERROR: ErrorCodeInfo = {
  code: 0,
  title: "Unknown Error",
  description: "An unrecognized error code was received from the device.",
  causes: ["Unknown cause"],
  solutions: ["Check device display for more details", "Contact EcoFlow support"],
  docsUrl: "https://www.ecoflow.com/support",
};

// BMS (Battery Management System) errors
const BMS_ERRORS: Record<number, ErrorCodeInfo> = {
  1: {
    code: "E01",
    title: "Over Temperature",
    description: "The device has shut down due to high internal temperature exceeding the safe threshold.",
    causes: [
      "Operating in high ambient temperature",
      "Blocked ventilation",
      "Running high-power loads for extended periods",
      "Direct sunlight exposure",
    ],
    solutions: [
      "Move the device to a cooler location",
      "Ensure proper ventilation around the unit",
      "Reduce the power load",
      "Wait for the device to cool down before restarting",
    ],
    youtubeUrl: "https://www.youtube.com/results?search_query=ecoflow+delta+pro+overheating+fix",
    docsUrl: "https://www.ecoflow.com/support",
  },
  2: {
    code: "E02",
    title: "Overload",
    description: "The connected devices are drawing more power than the station can provide.",
    causes: [
      "Total load exceeds maximum output capacity",
      "High inrush current from motor-driven appliances",
      "Short circuit in connected device",
    ],
    solutions: [
      "Disconnect some devices to reduce the load",
      "Check if any appliance has a short circuit",
      "Start high-power devices one at a time",
    ],
    youtubeUrl: "https://www.youtube.com/results?search_query=ecoflow+overload+error+fix",
    docsUrl: "https://www.ecoflow.com/support",
  },
  3: {
    code: "E03",
    title: "AC Output Short Circuit",
    description: "A short circuit has been detected on the AC output.",
    causes: [
      "Faulty appliance or cable",
      "Damaged power cord",
      "Water or moisture in connection",
    ],
    solutions: [
      "Disconnect all devices and check each one individually",
      "Inspect cables for damage",
      "Ensure all connections are dry",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  6: {
    code: 6,
    title: "Fully Charged (100%)",
    description: "The battery is fully charged to 100%. Charging has stopped.",
    causes: [
      "Battery reached maximum capacity",
    ],
    solutions: [
      "No action needed - this is normal operation",
      "You can disconnect the charger or continue using the device",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  23: {
    code: 23,
    title: "Charged to User Limit",
    description: "The battery has reached the maximum charge level set by the user.",
    causes: [
      "Battery reached the user-configured maximum SOC limit",
    ],
    solutions: [
      "No action needed - this is normal operation",
      "To charge higher, increase the Max Charge SOC in device settings",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  77: {
    code: 77,
    title: "Cell Voltage Imbalance",
    description: "Significant voltage difference detected among battery cells, indicating cell imbalance.",
    causes: [
      "Long storage without charging",
      "Extreme temperature exposure",
      "Battery aging",
      "Defective cell",
    ],
    solutions: [
      "Perform 2-3 full charge and discharge cycles",
      "Let the battery rest at full charge for 6+ hours",
      "If the issue persists, contact EcoFlow support",
    ],
    youtubeUrl: "https://www.youtube.com/results?search_query=ecoflow+battery+cell+imbalance+fix",
    docsUrl: "https://www.ecoflow.com/support",
  },
  115: {
    code: 115,
    title: "Too Cold for Charging",
    description: "The battery temperature is too low for safe charging. Charging is blocked to protect the cells.",
    causes: [
      "Ambient temperature below 32°F (0°C)",
      "Device was stored in cold environment",
    ],
    solutions: [
      "Move the device to a warmer location (above 32°F / 0°C)",
      "Wait for the battery to warm up naturally",
      "Do not use external heat sources directly on the battery",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  301: {
    code: 301,
    title: "Cell Under Voltage",
    description: "One or more battery cells have dropped below the safe voltage threshold.",
    causes: [
      "Deep discharge below minimum SOC",
      "Long storage without maintenance charge",
      "Cell degradation",
    ],
    solutions: [
      "Immediately connect to a charger",
      "Let the device charge fully before use",
      "If unable to charge, contact EcoFlow support",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  305: {
    code: 305,
    title: "USB1 Short Circuit",
    description: "A short circuit has been detected on USB port 1.",
    causes: [
      "Faulty USB cable",
      "Damaged connected device",
      "Metal object in USB port",
    ],
    solutions: [
      "Disconnect the USB device",
      "Inspect the USB port for debris",
      "Try a different USB cable",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
};

// Inverter errors
const INV_ERRORS: Record<number, ErrorCodeInfo> = {
  1: {
    code: 1,
    title: "Inverter Over Temperature",
    description: "The inverter has overheated and shut down to prevent damage.",
    causes: [
      "High power output for extended time",
      "Poor ventilation",
      "High ambient temperature",
    ],
    solutions: [
      "Reduce the AC load",
      "Improve ventilation around the device",
      "Wait for the inverter to cool down",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  2: {
    code: 2,
    title: "Inverter Overload",
    description: "The inverter is being overloaded beyond its capacity.",
    causes: [
      "Connected load exceeds inverter rating",
      "Motor startup surge",
    ],
    solutions: [
      "Reduce the connected load",
      "Use X-Boost mode for compatible appliances",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
};

// MPPT (Solar charge controller) errors
const MPPT_ERRORS: Record<number, ErrorCodeInfo> = {
  1: {
    code: 1,
    title: "Solar Input Over Voltage",
    description: "The solar panel voltage exceeds the maximum input voltage.",
    causes: [
      "Too many solar panels in series",
      "Panel voltage too high for the input",
    ],
    solutions: [
      "Reduce the number of panels in series",
      "Check panel specifications match device requirements",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
  4096: {
    code: 4096,
    title: "MPPT Communication Error",
    description: "Communication issue with the solar charge controller.",
    causes: [
      "Firmware issue",
      "Internal communication fault",
    ],
    solutions: [
      "Restart the device",
      "Update firmware to the latest version",
      "Contact support if issue persists",
    ],
    docsUrl: "https://www.ecoflow.com/support",
  },
};

// Overload state info
const OVERLOAD_INFO: ErrorCodeInfo = {
  code: 1,
  title: "Power Overload Active",
  description: "The device is currently in an overload state. Output may be limited.",
  causes: [
    "Connected load exceeds maximum output",
    "High inrush current from appliances",
  ],
  solutions: [
    "Disconnect some devices",
    "Reduce overall power consumption",
  ],
  docsUrl: "https://www.ecoflow.com/support",
};

// EMS abnormal state info
const EMS_ABNORMAL_INFO: ErrorCodeInfo = {
  code: 0,
  title: "EMS Abnormal State",
  description: "The Energy Management System is reporting an abnormal operating condition.",
  causes: [
    "Internal system fault",
    "Battery communication issue",
    "Sensor malfunction",
  ],
  solutions: [
    "Restart the device",
    "Check for firmware updates",
    "Contact EcoFlow support if issue persists",
  ],
  docsUrl: "https://www.ecoflow.com/support",
};

/**
 * Get error information for a specific error code
 */
export function getErrorInfo(type: ErrorType, code: number): ErrorCodeInfo {
  switch (type) {
    case 'bms':
    case 'battery':
      return BMS_ERRORS[code] || { ...UNKNOWN_ERROR, code };
    case 'inv':
      return INV_ERRORS[code] || { ...UNKNOWN_ERROR, code };
    case 'mppt':
      return MPPT_ERRORS[code] || { ...UNKNOWN_ERROR, code };
    case 'overload':
      return OVERLOAD_INFO;
    case 'ems':
      return EMS_ABNORMAL_INFO;
    default:
      return { ...UNKNOWN_ERROR, code };
  }
}

/**
 * Check if an error code has detailed information available
 */
export function hasErrorInfo(type: ErrorType, code: number): boolean {
  switch (type) {
    case 'bms':
    case 'battery':
      return code in BMS_ERRORS;
    case 'inv':
      return code in INV_ERRORS;
    case 'mppt':
      return code in MPPT_ERRORS;
    case 'overload':
    case 'ems':
      return true;
    default:
      return false;
  }
}
