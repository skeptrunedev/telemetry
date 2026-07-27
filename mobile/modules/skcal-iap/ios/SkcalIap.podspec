Pod::Spec.new do |s|
  s.name           = 'SkcalIap'
  s.version        = '1.0.0'
  s.summary        = 'StoreKit 2 in-app purchases for skcal'
  s.description    = 'Local Expo module wrapping StoreKit 2. Fetches products, runs purchases, and hands the JWS signed transaction to JS for server-side verification against the App Store Server API.'
  s.author         = 'skcal'
  s.homepage       = 'https://skcal.fit'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
