import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-pdf-viewer-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pdf-viewer-modal.component.html',
  styleUrls: ['./pdf-viewer-modal.component.scss']
})
export class PdfViewerModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() pdfBlob: Blob | null = null;
  @Input() fileName = '';

  @Output() fechado = new EventEmitter<void>();

  @ViewChild('modalElement') modalElement!: ElementRef<HTMLDivElement>;

  safePdfUrl: SafeResourceUrl | null = null;
  private objectUrl: string | null = null;
  private modal: any;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    if (this.pdfBlob) {
      this.objectUrl = URL.createObjectURL(this.pdfBlob);
      this.safePdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
    }
  }

  ngAfterViewInit(): void {
    const Bootstrap = (window as any).bootstrap;
    if (!Bootstrap) return;

    this.modal = new Bootstrap.Modal(this.modalElement.nativeElement, {
      backdrop: 'static'
    });

    this.modalElement.nativeElement.addEventListener('hidden.bs.modal', () => {
      this.fechado.emit();
    });

    this.modal.show();
  }

  onCancel(): void {
    this.modal?.hide();
  }

  onDownload(): void {
    if (!this.pdfBlob) return;
    const url = URL.createObjectURL(this.pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if (this.modal?.dispose) this.modal.dispose();
  }
}