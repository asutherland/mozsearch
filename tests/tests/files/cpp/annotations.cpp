// Excerpts of attribute-generating macros used throughout the m-c codebase.

#include <mutex>

// From mfbt/Attributes.h
#define MOZ_OWNING_REF __attribute__((annotate("moz_owning_ref")))
#define MOZ_UNSAFE_REF(reason) __attribute__((annotate("moz_unsafe_ref")))

// From mfbt/ThreadSafety.h
// Operation described at
// https://firefox-source-docs.mozilla.org/xpcom/thread-safety.html but our goal
// here is just to ensure

#define MOZ_THREAD_ANNOTATION_ATTRIBUTE__(x) __attribute__((x))

#define MOZ_GUARDED_BY(x) MOZ_THREAD_ANNOTATION_ATTRIBUTE__(guarded_by(x))
#define MOZ_GUARDED_VAR MOZ_THREAD_ANNOTATION_ATTRIBUTE__(guarded_var)
#define MOZ_REQUIRES(...) \
  MOZ_THREAD_ANNOTATION_ATTRIBUTE__(exclusive_locks_required(__VA_ARGS__))

class FunAnnotatedClass {
  void singleLockedFunc() MOZ_REQUIRES(mFirstLock) {}
  void doubleLockedFunc() MOZ_REQUIRES(mFirstLock, mSecondLock) {}

  std::mutex mFirstLock;
  std::mutex mSecondLock;

  int firstProtectedField MOZ_GUARDED_BY(mFirstLock);
  int generallyProtectedField MOZ_GUARDED_VAR;
};
