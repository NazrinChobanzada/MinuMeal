# Where the Android build finds Java and the SDK.
#
# Android Studio ships its own JDK, but it is version 25 and the Gradle that
# Capacitor generates (8.14.3) only understands up to Java 24 — it fails with
# "Unsupported class file major version 69". So the build uses a JDK 21 installed
# separately, which is the version Android tooling is actually built against.
#
# Nothing here touches the system Java. Sourced by the npm scripts in package.json.

for candidate in \
  /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
  /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
do
  if [ -x "$candidate/bin/java" ]; then
    export JAVA_HOME="$candidate"
    break
  fi
done

if [ -z "$JAVA_HOME" ]; then
  echo "No JDK 21 or 17 found. Install one with:  brew install openjdk@21" >&2
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
