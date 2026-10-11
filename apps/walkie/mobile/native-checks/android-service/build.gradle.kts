// Compile-checks WalkieForegroundService.kt against the real Android 16
// framework classes (Robolectric's android-all jar from Maven Central),
// without an Android SDK. It does NOT build an app or run the service; it
// catches type and API errors in the service early. The Expo bridge
// (WalkieBackgroundModule.kt) needs expo-modules-core and is only compiled
// by a real Android build.
//
//   gradle -p apps/walkie/mobile/native-checks/android-service compileKotlin
plugins { kotlin("jvm") version "2.1.21" }

repositories { mavenCentral() }

dependencies {
  compileOnly("org.robolectric:android-all:16-robolectric-13921718")
}

kotlin {
  sourceSets["main"].kotlin.apply {
    srcDir("../../modules/walkie-background/android/src/main/java")
    include("**/WalkieForegroundService.kt")
  }
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
  compilerOptions { allWarningsAsErrors.set(true) }
}
