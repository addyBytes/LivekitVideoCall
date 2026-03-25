package com.videocallapp

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

class TranscriptionModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), RecognitionListener, LifecycleEventListener {

  companion object {
    private const val RESULT_EVENT = "onTranscriptionResult"
    private const val ERROR_EVENT = "onTranscriptionError"
    private const val STATE_EVENT = "onTranscriptionStateChanged"
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var speechRecognizer: SpeechRecognizer? = null
  private var recognizerIntent: Intent? = null
  private var keepListening = false
  private var isListening = false

  private val restartRunnable = Runnable {
    if (!keepListening || isListening) {
      return@Runnable
    }
    startListeningInternal()
  }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = "TranscriptionModule"

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  @ReactMethod
  fun isAvailable(promise: Promise) {
    runOnMainThread {
      promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactApplicationContext))
    }
  }

  @ReactMethod
  fun start(localeTag: String?, promise: Promise) {
    runOnMainThread {
      if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
        promise.reject("UNAVAILABLE", "Speech recognition is not available on this device.")
        return@runOnMainThread
      }

      val hasAudioPermission =
        ContextCompat.checkSelfPermission(
          reactApplicationContext,
          Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

      if (!hasAudioPermission) {
        promise.reject("NO_PERMISSION", "Microphone permission is required for transcription.")
        return@runOnMainThread
      }

      try {
        keepListening = true
        recognizerIntent = buildRecognizerIntent(localeTag)

        ensureRecognizer()
        mainHandler.removeCallbacks(restartRunnable)
        startListeningInternal()
        promise.resolve(null)
      } catch (error: Exception) {
        keepListening = false
        isListening = false
        promise.reject("START_FAILED", error.message ?: "Failed to start transcription.")
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    runOnMainThread {
      stopInternal()
      promise.resolve(null)
    }
  }

  private fun buildRecognizerIntent(localeTag: String?): Intent {
    val normalizedLocale =
      if (localeTag.isNullOrBlank()) {
        Locale.getDefault().toLanguageTag()
      } else {
        localeTag
      }

    return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, normalizedLocale)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, normalizedLocale)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1000L)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, reactApplicationContext.packageName)
    }
  }

  private fun ensureRecognizer() {
    if (speechRecognizer != null) {
      return
    }

    val recognizer =
      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(reactApplicationContext)
      ) {
        SpeechRecognizer.createOnDeviceSpeechRecognizer(reactApplicationContext)
      } else {
        val preferredService = findPreferredRecognitionService()
        if (preferredService != null) {
          SpeechRecognizer.createSpeechRecognizer(reactApplicationContext, preferredService)
        } else {
          SpeechRecognizer.createSpeechRecognizer(reactApplicationContext)
        }
      }

    speechRecognizer = recognizer.also {
      it.setRecognitionListener(this)
    }
  }

  private fun findPreferredRecognitionService(): ComponentName? {
    val packageManager = reactApplicationContext.packageManager
    val services =
      packageManager.queryIntentServices(
        Intent(RecognitionService.SERVICE_INTERFACE),
        PackageManager.MATCH_DEFAULT_ONLY,
      )

    if (services.isNullOrEmpty()) {
      return null
    }

    val preferredGoogleService =
      services.firstOrNull { resolveInfo ->
        val packageName = resolveInfo.serviceInfo?.packageName ?: return@firstOrNull false
        packageName.contains("googlequicksearchbox") || packageName.contains("google")
      }

    val selectedService = preferredGoogleService ?: services.first()
    val serviceInfo = selectedService.serviceInfo ?: return null

    return ComponentName(serviceInfo.packageName, serviceInfo.name)
  }

  private fun startListeningInternal() {
    val intent = recognizerIntent ?: buildRecognizerIntent(null).also {
      recognizerIntent = it
    }

    val recognizer = speechRecognizer ?: return

    try {
      recognizer.startListening(intent)
      isListening = true
      emitState(true)
    } catch (error: Exception) {
      isListening = false
      emitError(error.message ?: "Failed to start transcription.")
      scheduleRestart(800L)
    }
  }

  private fun scheduleRestart(delayMs: Long) {
    if (!keepListening) {
      return
    }
    mainHandler.removeCallbacks(restartRunnable)
    mainHandler.postDelayed(restartRunnable, delayMs)
  }

  private fun stopInternal() {
    keepListening = false
    isListening = false
    mainHandler.removeCallbacks(restartRunnable)

    speechRecognizer?.run {
      try {
        stopListening()
      } catch (_: Exception) {
      }

      try {
        cancel()
      } catch (_: Exception) {
      }
    }

    emitState(false)
  }

  private fun destroyRecognizer() {
    runOnMainThread {
      stopInternal()
      speechRecognizer?.destroy()
      speechRecognizer = null
    }
  }

  private fun runOnMainThread(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
    } else {
      mainHandler.post { action() }
    }
  }

  private fun emitResult(text: String, isFinal: Boolean) {
    if (text.isBlank() || !reactApplicationContext.hasActiveReactInstance()) {
      return
    }

    val payload = Arguments.createMap().apply {
      putString("text", text)
      putBoolean("isFinal", isFinal)
    }

    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(RESULT_EVENT, payload)
  }

  private fun emitError(message: String) {
    if (!reactApplicationContext.hasActiveReactInstance()) {
      return
    }

    val payload = Arguments.createMap().apply {
      putString("message", message)
    }

    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(ERROR_EVENT, payload)
  }

  private fun emitState(active: Boolean) {
    if (!reactApplicationContext.hasActiveReactInstance()) {
      return
    }

    val payload = Arguments.createMap().apply {
      putBoolean("active", active)
    }

    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(STATE_EVENT, payload)
  }

  override fun onReadyForSpeech(params: Bundle?) {
    emitError("Listening for speech...")
  }

  override fun onBeginningOfSpeech() {
    emitError("Speech detected...")
  }

  override fun onRmsChanged(rmsdB: Float) = Unit

  override fun onBufferReceived(buffer: ByteArray?) = Unit

  override fun onEndOfSpeech() {
    isListening = false
    emitError("Processing speech...")
    scheduleRestart(350L)
  }

  override fun onError(error: Int) {
    isListening = false
    if (!keepListening) {
      emitState(false)
      return
    }

    val message =
      when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "Audio capture issue while transcribing."
        SpeechRecognizer.ERROR_CLIENT -> "Transcription stopped."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is missing."
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network issue."
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Listening for speech..."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer is busy. Retrying..."
        SpeechRecognizer.ERROR_SERVER -> "Speech recognition service error."
        else -> "Transcription error."
      }

    emitError(message)

    val restartDelay =
      when (error) {
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> 900L
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> 300L
        else -> 700L
      }

    scheduleRestart(restartDelay)
  }

  override fun onResults(results: Bundle?) {
    isListening = false
    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
    if (!text.isNullOrBlank()) {
      emitResult(text, true)
    }
    scheduleRestart(350L)
  }

  override fun onPartialResults(partialResults: Bundle?) {
    val text =
      partialResults
        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        ?.firstOrNull()

    if (!text.isNullOrBlank()) {
      emitResult(text, false)
    }
  }

  override fun onEvent(eventType: Int, params: Bundle?) = Unit

  override fun onHostResume() = Unit

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    destroyRecognizer()
  }
}
