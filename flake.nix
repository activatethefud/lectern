{
  description = "slide-course — courses that are pptx decks";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            python3            # stdlib only: http.server, sqlite3, unittest
            poppler_utils      # pdfinfo, pdftoppm  (pptx -> pdf -> webp)
            libreoffice        # soffice: pptx -> pdf, and certificate html -> pdf
            qrencode           # optional QR on the certificate
            git
          ];
          shellHook = ''
            export COURSE_ROOT="''${COURSE_ROOT:-$PWD}"
            echo "slide-course dev shell: $(python3 -V)"
          '';
        };
      });
    };
}
