package com.videocallapp

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    @JvmField
    var isInCallPipEnabled: Boolean = false
  }

  override fun getName(): String = "PipModule"

  @ReactMethod
  fun setInCallPipEnabled(enabled: Boolean) {
    isInCallPipEnabled = enabled
  }

  @ReactMethod
  fun supportsPip(promise: Promise) {
    val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    promise.resolve(supported)
  }

  @ReactMethod
  fun enterPictureInPicture() {
    val activity = reactApplicationContext.currentActivity ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (activity.isInPictureInPictureMode) return

    activity.runOnUiThread {
      val params = PictureInPictureParams.Builder()
        .setAspectRatio(Rational(9, 16)) // Portrait aspect ratio for vertical PiP
        .build()
      activity.enterPictureInPictureMode(params)
    }
  }
}
