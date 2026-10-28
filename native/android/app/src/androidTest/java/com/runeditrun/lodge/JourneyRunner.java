package com.runeditrun.lodge;

import android.os.Bundle;
import android.test.InstrumentationTestRunner;

public final class JourneyRunner extends InstrumentationTestRunner {
    static Bundle options;
    @Override public void onCreate(Bundle arguments) { options = arguments; super.onCreate(arguments); }
}
