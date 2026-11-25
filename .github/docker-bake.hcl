variable "VPS_PLATFORM" {}
variable "IMAGE_PREFIX" {}
variable "IMAGE_TAG" {}
variable "IMAGE_SOURCE" {}

target "images" {
  name = image.name
  matrix = {
    image = [
      { name = "bot", context = "backend", dockerfile = "Dockerfile", stage = "bot-runtime" },
      { name = "core", context = "backend", dockerfile = "Dockerfile", stage = "core-runtime" },
      { name = "input", context = "backend", dockerfile = "Dockerfile", stage = "input-runtime" },
      { name = "migrate", context = "backend", dockerfile = "Dockerfile", stage = "migrate" },
      { name = "mini-app", context = "mini-app", dockerfile = "Dockerfile", stage = null },
      { name = "whisper", context = "backend", dockerfile = "Dockerfile.whisper", stage = "runtime" }
    ]
  }

  context    = image.context
  dockerfile = image.dockerfile
  target     = image.stage
  platforms  = [VPS_PLATFORM]
  tags       = ["${IMAGE_PREFIX}/${image.name}:${IMAGE_TAG}"]
  labels     = { "org.opencontainers.image.source" = IMAGE_SOURCE }
  cache-from = ["type=gha,scope=${image.name}-${replace(VPS_PLATFORM, "/", "-")}"]
  cache-to   = ["type=gha,mode=max,scope=${image.name}-${replace(VPS_PLATFORM, "/", "-")}"]
}
