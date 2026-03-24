package com.videocallapp

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "VideoCallApp"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    // Disabled: Only JS should trigger PiP entry to allow UI to be hidden before snapshot.
    // if (!PipModule.isInCallPipEnabled) return
    // if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !isInPictureInPictureMode) {
    //   val params = PictureInPictureParams.Builder()
    //     .setAspectRatio(Rational(9, 16))
    //     .build()
    //   enterPictureInPictureMode(params)
    // }
  }
}
