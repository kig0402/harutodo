package com.harutodo.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import java.util.Calendar

object AlarmScheduler {
    private const val PREFS = "haru_alarms_prefs"
    private const val KEY_JSON = "alarms_json"
    private const val KEY_REQ_CODES = "alarm_req_codes"

    fun syncAlarms(context: Context, jsonStr: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        cancelExistingAlarms(context)
        prefs.edit().putString(KEY_JSON, jsonStr).apply()
        scheduleFromJson(context, jsonStr)
    }

    fun rescheduleSavedAlarms(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val jsonStr = prefs.getString(KEY_JSON, "[]") ?: "[]"
        cancelExistingAlarms(context)
        scheduleFromJson(context, jsonStr)
    }

    private fun cancelExistingAlarms(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val savedCodes = prefs.getStringSet(KEY_REQ_CODES, emptySet()) ?: emptySet()
        for (codeStr in savedCodes) {
            val code = codeStr.toIntOrNull() ?: continue
            val intent = Intent(context, AlarmReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                context,
                code,
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pi != null) {
                alarmManager.cancel(pi)
                pi.cancel()
            }
        }
        prefs.edit().putStringSet(KEY_REQ_CODES, emptySet()).apply()
    }

    private fun scheduleFromJson(context: Context, jsonStr: String) {
        val arr = try {
            JSONArray(jsonStr)
        } catch (_: Exception) {
            return
        }
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        val activeCodes = mutableSetOf<String>()

        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val id = obj.optString("id", "").trim()
            val title = obj.optString("title", "").trim()
            val date = obj.optString("date", "").trim()
            val time = obj.optString("time", "").trim()
            if (id.isEmpty() || title.isEmpty() || date.length < 10 || time.length < 5) continue

            val triggerAt = parseTriggerMillis(date, time) ?: continue
            if (triggerAt <= now) continue

            val reqCode = id.hashCode()
            activeCodes.add(reqCode.toString())

            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra("task_id", id)
                putExtra("task_title", title)
                putExtra("task_time", time)
                putExtra("notif_id", reqCode)
            }
            val pi = PendingIntent.getBroadcast(
                context,
                reqCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                } else {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                }
            } catch (_: SecurityException) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
        }

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(KEY_REQ_CODES, activeCodes)
            .apply()
    }

    private fun parseTriggerMillis(date: String, time: String): Long? {
        return try {
            val dp = date.split("-")
            val tp = time.split(":")
            if (dp.size != 3 || tp.size < 2) return null
            val cal = Calendar.getInstance().apply {
                set(Calendar.YEAR, dp[0].toInt())
                set(Calendar.MONTH, dp[1].toInt() - 1)
                set(Calendar.DAY_OF_MONTH, dp[2].toInt())
                set(Calendar.HOUR_OF_DAY, tp[0].toInt())
                set(Calendar.MINUTE, tp[1].toInt())
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            cal.timeInMillis
        } catch (_: Exception) {
            null
        }
    }
}
