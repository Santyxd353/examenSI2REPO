package bo.edu.grupo18.reportspeech

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ReportSpeechModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var pending: Promise? = null

  private fun clear() {
    recognizer?.destroy()
    recognizer = null
    pending = null
  }

  private fun errorMessage(code: Int) = when (code) {
    SpeechRecognizer.ERROR_AUDIO -> "No se pudo usar el micrófono."
    SpeechRecognizer.ERROR_CLIENT -> "La dictación se canceló."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Permite el micrófono para dictar una consulta."
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "La dictación requiere conexión con el servicio de voz de Android."
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No se reconoció una frase. Intenta hablar nuevamente."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "El reconocimiento de voz ya está ocupado."
    else -> "No fue posible reconocer la voz."
  }

  override fun definition() = ModuleDefinition {
    Name("VestidorReportSpeech")

    AsyncFunction("recognize") { promise: Promise ->
      mainHandler.post {
        if (pending != null) {
          promise.reject("E_SPEECH_BUSY", "Ya hay una consulta de voz en curso.", null)
          return@post
        }
        val context = appContext.reactContext
        if (context == null || !SpeechRecognizer.isRecognitionAvailable(context)) {
          promise.reject("E_SPEECH_UNAVAILABLE", "El reconocimiento de voz no está disponible en este teléfono.", null)
          return@post
        }
        pending = promise
        try {
          val speech = SpeechRecognizer.createSpeechRecognizer(context)
          recognizer = speech
          speech.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit

            override fun onError(error: Int) {
              val active = pending ?: return
              clear()
              active.reject("E_SPEECH_$error", errorMessage(error), null)
            }

            override fun onResults(results: Bundle?) {
              val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
              val active = pending ?: return
              clear()
              if (text.isBlank()) active.reject("E_SPEECH_EMPTY", "No se reconoció una frase.", null)
              else active.resolve(text)
            }
          })
          speech.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-BO")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
          })
        } catch (error: Exception) {
          clear()
          promise.reject("E_SPEECH_START", "No se pudo iniciar la dictación.", error)
        }
      }
    }

    Function("cancel") {
      mainHandler.post {
        recognizer?.cancel()
        clear()
      }
    }
  }
}
