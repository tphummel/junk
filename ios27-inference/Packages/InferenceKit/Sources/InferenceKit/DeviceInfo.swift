import Foundation

/// Facts about the device and OS, recorded alongside results so runs can be compared across updates.
public struct DeviceInfo: Equatable, Sendable {
    /// e.g. "Version 27.1 (Build 24B83)".
    public var osVersion: String
    /// Hardware identifier, e.g. "iPhone18,1". In the simulator this is the simulated device's identifier.
    public var modelIdentifier: String

    public init(osVersion: String, modelIdentifier: String) {
        self.osVersion = osVersion
        self.modelIdentifier = modelIdentifier
    }

    public static var current: DeviceInfo {
        DeviceInfo(
            osVersion: ProcessInfo.processInfo.operatingSystemVersionString,
            modelIdentifier: ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? hardwareIdentifier()
        )
    }

    private static func hardwareIdentifier() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}
