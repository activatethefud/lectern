{
  description = "slide-course — courses that are pptx decks (Nuxt 4 + baked slide images)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22          # >=22.11; node:sqlite for the attempt store
            poppler_utils      # pdfinfo, pdftoppm — bake: pptx -> pdf -> webp
            libreoffice        # soffice --convert-to pdf
            qrencode           # QR on the certificate
            git
          ];
          shellHook = ''
            export COURSE_ROOT="''${COURSE_ROOT:-$PWD/courses}"
            export DATA_DIR="''${DATA_DIR:-$PWD/data}"
            echo "slide-course: node $(node -v) · $(soffice --version 2>/dev/null | head -1)"
          '';
        };
      });
    };
}
